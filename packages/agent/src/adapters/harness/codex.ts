//
// Codex (OpenAI) HarnessRuntime — OpenAI function-calling format adapter.
//
// Codex (OpenAI's CLI coding agent) expects:
//   - English prompts with function-calling format
//   - OpenAI-compatible tool definitions
//   - JSON-structured outputs
//
// This harness:
//   1. Converts Cabinet prompts to Codex-friendly format
//   2. Injects HarnessSkill for Cabinet protocol awareness
//   3. Parses Codex output format
//

import { spawn, type ChildProcess } from 'node:child_process';
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

// ── CodexRuntime ────────────────────────────────────────────────

export class CodexRuntime implements HarnessRuntime {
  readonly harnessId = 'codex';
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
      this.logger?.warn(`Codex agent ${this.agentId} not detected`);
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
      await this.execSimple('codex', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execSimple('npm', ['install', '-g', '@openai/codex-cli']);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Prompt Conversion ─────────────────────────────────────────
  //
  // Codex uses OpenAI's function-calling conventions.
  // Prompts are structured with clear system/user/assistant roles.

  convertPrompt(task: ExternalTask, context?: HarnessContext): string {
    const slot = task.slot;
    const parts: string[] = [];

    // System-level: inject Cabinet skill
    parts.push(this.injectSkill());
    parts.push('');
    parts.push('---');
    parts.push('');

    // User-level: the actual task
    const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input, null, 2);
    parts.push(input);
    parts.push('');

    // Context
    if (slot.project?.name) {
      parts.push('## Context');
      parts.push(`Project: ${slot.project.name}`);
      parts.push(`Tech: ${slot.project.tech_stack ?? 'unspecified'}`);
      if (context?.workspacePath) {
        parts.push(`Workspace: ${context.workspacePath}`);
      }
      parts.push('');
    }

    // Related information
    if (slot.memories?.length || slot.files?.length) {
      parts.push('## Background');
      for (const m of (slot.memories ?? [])) {
        parts.push(`- ${m}`);
      }
      for (const f of (slot.files ?? [])) {
        parts.push(`- File: ${f}`);
      }
      parts.push('');
    }

    // Output protocol
    parts.push('## Required Output Format');
    parts.push('');
    parts.push('During execution, report findings:');
    parts.push('```');
    parts.push(DISCOVERY_MARKER);
    parts.push('{"type": "finding", "summary": "description"}');
    parts.push(`${END_PREFIX}DISCOVERY===`);
    parts.push('```');
    parts.push('');
    parts.push('Final deliverable:');
    parts.push('```');
    parts.push(DELIVERABLE_MARKER);
    parts.push('<result>');
    parts.push(`${END_PREFIX}DELIVERABLE===`);
    parts.push('```');

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

    // OpenAI format: "usage": {"prompt_tokens": 100, "completion_tokens": 50}
    const usageMatch = combined.match(/"prompt_tokens":\s*(\d+)[^}]*"completion_tokens":\s*(\d+)/);
    if (usageMatch?.[1] && usageMatch?.[2]) {
      metrics.tokensUsed = parseInt(usageMatch[1], 10) + parseInt(usageMatch[2], 10);
    }

    // Model info: "model": "gpt-5"
    const modelMatch = combined.match(/"model":\s*"([^"]+)"/);
    if (modelMatch) {
      metrics.model = modelMatch[1];
    }

    // Tool calls count
    const toolMatches = combined.match(/"name":\s*"[^"]+"/g);
    if (toolMatches) {
      metrics.toolCalls = toolMatches.length;
    }

    // Duration
    const durMatch = combined.match(/(?:duration|elapsed|completed in)[^0-9]*(\d+\.?\d*)\s*(s|sec)/i);
    if (durMatch?.[1]) {
      metrics.durationMs = Math.round(parseFloat(durMatch[1]) * 1000);
    }

    return metrics;
  }

  injectSkill(): string {
    return [
      '# Cabinet Agent Protocol (Codex Edition)',
      '',
      'You are an external agent in the **Cabinet AI orchestration framework**, running via Codex (OpenAI).',
      '',
      '## Your Role',
      '- Execute the task described below using your available tools.',
      '- Report intermediate findings using the discovery marker format.',
      '- Submit your final deliverable using the deliverable marker format.',
      '',
      '## Output Format',
      `- Discoveries: \`${DISCOVERY_MARKER}\\n{JSON}\\n${END_PREFIX}DISCOVERY===\``,
      `- Deliverable: \`${DELIVERABLE_MARKER}\\n<content>\\n${END_PREFIX}DELIVERABLE===\``,
      '',
      '## Available Context',
      'The task includes project context, memories, and file references from Cabinet.',
      'Use these to understand the broader project goals.',
      '',
      '## Constraints',
      '- Work within the provided working directory.',
      '- Respect the security level and retry limits.',
      '- Flag any ambiguities before proceeding.',
    ].join('\n');
  }

  async discoverSessions?(): Promise<string[]> {
    return [];
  }

  // ── Task Dispatch ─────────────────────────────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    const timeoutMs = this.config.timeoutMs ?? task.configuration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();
    const command = this.config.command ?? 'codex';
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
          else reject(new Error(`Codex exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
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
      { name: 'code_generation', description: 'Generate and edit code using OpenAI models' },
      { name: 'file_operations', description: 'Read, write, and manage files' },
      { name: 'shell_execution', description: 'Execute shell commands' },
      { name: 'analysis', description: 'Analyze code and provide insights' },
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
