//
// OpenCode HarnessRuntime — SQLite session + Markdown output adapter.
//
// OpenCode uses:
//   - A SQLite database for session persistence
//   - Markdown-based output format
//   - CLI interface (opencode) similar to Claude Code but with different flags
//
// This harness:
//   1. Converts Cabinet prompts to OpenCode's expected format
//   2. Injects HarnessSkill for Cabinet protocol awareness
//   3. Can discover/resume OpenCode sessions from SQLite DB
//

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
} from '../types.js';
import type { HarnessRuntime, HarnessContext, AgentTaskMetrics, HarnessConfig } from '../harness-runtime.js';

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 300_000;
const DELIVERABLE_MARKER = '===CABINET_DELIVERABLE===';
const DISCOVERY_MARKER = '===CABINET_DISCOVERY===';
const END_PREFIX = '===END_';

// OpenCode session directory
const OPENCODE_DIR = join(homedir(), '.opencode');

// ── OpenCodeRuntime ──────────────────────────────────────────────

export class OpenCodeRuntime implements HarnessRuntime {
  readonly harnessId = 'opencode';
  readonly protocol = 'cli' as const;
  private processes = new Map<string, ChildProcess>();

  constructor(
    readonly agentId: string,
    private config: HarnessConfig,
    private capabilities: AgentCapability[] = [],
    private logger?: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void },
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────

  async start(): Promise<void> {
    const available = await this.detect();
    if (!available) {
      this.logger?.warn(`OpenCode agent ${this.agentId} not detected`);
    }
  }

  async stop(): Promise<void> {
    for (const [, proc] of this.processes) {
      if (!proc.killed) proc.kill('SIGTERM');
    }
    this.processes.clear();
  }

  async healthCheck(): Promise<boolean> {
    return this.detect();
  }

  async detect(): Promise<boolean> {
    try {
      await this.execSimple('opencode', ['--version']);
      return true;
    } catch {
      // Also check if the opencode directory exists (pre-installed but not on PATH)
      return existsSync(OPENCODE_DIR);
    }
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execSimple('npm', ['install', '-g', 'opencode']);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Prompt Conversion ─────────────────────────────────────────
  //
  // OpenCode accepts natural language prompts with Markdown formatting.

  convertPrompt(task: ExternalTask, context?: HarnessContext): string {
    const slot = task.slot;
    const parts: string[] = [];

    // Inject protocol
    parts.push(this.injectSkill());
    parts.push('');
    parts.push('---');
    parts.push('');

    // Task
    const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input, null, 2);
    parts.push('## Task');
    parts.push(input);
    parts.push('');

    // Context
    if (slot.project?.name) {
      parts.push('## Project');
      parts.push(`- Name: ${slot.project.name}`);
      parts.push(`- Stack: ${slot.project.tech_stack ?? 'unspecified'}`);
      if (context?.workspacePath) parts.push(`- Workspace: ${context.workspacePath}`);
      parts.push('');
    }

    if (slot.memories?.length) {
      parts.push('## Memories');
      for (const m of slot.memories) parts.push(`- ${m}`);
      parts.push('');
    }

    if (slot.files?.length) {
      parts.push('## Files');
      for (const f of slot.files) parts.push(`- ${f}`);
      parts.push('');
    }

    // Output protocol
    parts.push('## Output Format');
    parts.push(`- Findings: \`${DISCOVERY_MARKER}\\n{JSON}\\n${END_PREFIX}DISCOVERY===\``);
    parts.push(`- Final: \`${DELIVERABLE_MARKER}\\n<result>\\n${END_PREFIX}DELIVERABLE===\``);
    parts.push('');
    parts.push('Complete the task using your tools. Report findings as you go.');

    return parts.join('\n');
  }

  // ── Output Parsing ────────────────────────────────────────────

  parseOutput(stdout: string, _stderr: string, taskId: string, startedAt: string): ExternalTaskResult {
    const discoveries = this.extractTaggedSections(stdout, DISCOVERY_MARKER).map((d) => {
      try { return JSON.parse(d) as { type: string; summary: string; [key: string]: unknown }; }
      catch { return { type: 'text', summary: d.trim() }; }
    });
    const deliverable = this.extractDeliverable(stdout);

    return {
      task_id: taskId,
      status: 'completed',
      output: deliverable ?? stdout,
      discoveries,
      audit: {
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      },
    };
  }

  extractMetrics(stdout: string, stderr: string): AgentTaskMetrics {
    const combined = stdout + '\n' + stderr;
    const metrics: AgentTaskMetrics = {};

    const tokenMatch = combined.match(/(\d[\d_,]*)\s*tokens?\s*(?:used|consumed)/i);
    if (tokenMatch?.[1]) {
      metrics.tokensUsed = parseInt(tokenMatch[1].replace(/[_,]/g, ''), 10);
    }

    const modelMatch = combined.match(/model:?\s*([a-zA-Z][\w.-]+)/i);
    if (modelMatch) {
      metrics.model = modelMatch[1];
    }

    const durMatch = combined.match(/(\d+\.?\d*)\s*(?:seconds?|s)\s*(?:elapsed|duration|total)/i);
    if (durMatch?.[1]) {
      metrics.durationMs = Math.round(parseFloat(durMatch[1]) * 1000);
    }

    return metrics;
  }

  injectSkill(): string {
    return [
      '# Cabinet Agent Protocol (OpenCode Edition)',
      '',
      'You are running inside the **Cabinet AI orchestration framework** as an OpenCode agent.',
      '',
      '## Protocol',
      'Cabinet dispatches tasks to you with project context and background information.',
      'Your responses are parsed by Cabinet and routed back to the user.',
      '',
      '## Output Format',
      `- Report intermediate findings: \`${DISCOVERY_MARKER}\\n{"type":"...","summary":"..."}\\n${END_PREFIX}DISCOVERY===\``,
      `- Submit final deliverable: \`${DELIVERABLE_MARKER}\\n<content>\\n${END_PREFIX}DELIVERABLE===\``,
      '',
      '## Guidelines',
      '- Use the working directory for all file operations.',
      '- Report progress with discovery markers.',
      '- Respect security and retry constraints from the task configuration.',
      '- Read files before modifying them.',
    ].join('\n');
  }

  async discoverSessions?(): Promise<string[]> {
    const sessions: string[] = [];
    try {
      const dbPath = join(OPENCODE_DIR, 'sessions.db');
      if (!existsSync(dbPath)) return sessions;
      // OpenCode stores sessions in a SQLite database
      // For now, just report if the DB exists
      sessions.push(dbPath);
    } catch { /* best effort */ }
    return sessions;
  }

  // ── Task Dispatch ─────────────────────────────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    const timeoutMs = this.config.timeoutMs ?? task.configuration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();
    const command = this.config.command ?? 'opencode';
    const args = [...(this.config.args ?? [])];

    try {
      const prompt = this.convertPrompt(task);

      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.config.env },
        cwd: task.configuration.working_directory ?? process.cwd(),
        timeout: timeoutMs,
      });

      this.processes.set(task.task_id, proc);
      proc.stdin!.write(prompt);
      proc.stdin!.end();

      const [stdout, stderr] = await Promise.all([
        this.readStream(proc.stdout!, timeoutMs),
        this.collectStderr(proc.stderr!),
      ]);

      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => {
          this.processes.delete(task.task_id);
          if (code === 0 || code === null) resolve();
          else reject(new Error(`OpenCode exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
        });
        proc.on('error', (err) => {
          this.processes.delete(task.task_id);
          reject(err);
        });
      });

      return this.parseOutput(stdout, stderr, task.task_id, startedAt);
    } catch (err) {
      this.processes.delete(task.task_id);
      const message = err instanceof Error ? err.message : String(err);
      return {
        task_id: task.task_id,
        status: message.includes('timed out') ? 'timed_out' : 'failed',
        error: message,
        audit: { started_at: startedAt, completed_at: new Date().toISOString() },
      };
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const proc = this.processes.get(taskId);
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      this.processes.delete(taskId);
    }
  }

  getCapabilities(): AgentCapability[] {
    return this.capabilities.length > 0 ? this.capabilities : [
      { name: 'code_generation', description: 'Generate and edit code' },
      { name: 'file_operations', description: 'Read, write, and manage files' },
      { name: 'shell_execution', description: 'Execute shell commands' },
    ];
  }

  // ── Private helpers ────────────────────────────────────────────

  private extractTaggedSections(stdout: string, marker: string): string[] {
    const results: string[] = [];
    const endTag = `${END_PREFIX}${marker.replace(/^===/, '')}===`;
    let searchFrom = 0;
    while (searchFrom < stdout.length) {
      const start = stdout.indexOf(marker, searchFrom);
      if (start === -1) break;
      const contentStart = start + marker.length;
      const end = stdout.indexOf(endTag, contentStart);
      if (end === -1) break;
      results.push(stdout.slice(contentStart, end).trim());
      searchFrom = end + endTag.length;
    }
    return results;
  }

  private extractDeliverable(stdout: string): string | undefined {
    const sections = this.extractTaggedSections(stdout, DELIVERABLE_MARKER);
    return sections.length > 0 ? sections[sections.length - 1] : undefined;
  }

  private readStream(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => reject(new Error(`Process timed out after ${timeoutMs}ms`)), timeoutMs);
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf-8')); });
      stream.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  }

  private collectStderr(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    return new Promise((resolve) => {
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', () => resolve(''));
    });
  }

  private execSimple(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });
      const chunks: Buffer[] = [];
      proc.stdout?.on('data', (c: Buffer) => chunks.push(c));
      proc.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(chunks).toString('utf-8'));
        else reject(new Error(`Exit code ${code}`));
      });
      proc.on('error', reject);
    });
  }
}
