//
// Claude Code HarnessRuntime — Anthropic tool-use format adapter.
//
// Claude Code (the official Anthropic CLI) expects:
//   - Natural-language English prompts (not Cabinet's Chinese format)
//   - Tool-use via Anthropic's tool-use protocol
//   - Session management via --resume or --continue
//   - Output with structured JSON blocks
//
// This harness:
//   1. Converts Cabinet's Chinese prompt to Claude Code-friendly English
//   2. Injects HarnessSkill to teach Claude Code about Cabinet protocol
//   3. Parses Claude Code's output format (JSON blocks + file references)
//   4. Discovers active Claude Code sessions for resume
//

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
} from '../types.js';
import type { HarnessRuntime, HarnessContext, AgentTaskMetrics, HarnessConfig } from '../harness-runtime.js';

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 300_000; // Claude Code can take longer
const DELIVERABLE_MARKER = '===CABINET_DELIVERABLE===';
const DISCOVERY_MARKER = '===CABINET_DISCOVERY===';
const END_PREFIX = '===END_';

// Claude Code session directory
const CLAUDE_SESSIONS_DIR = join(homedir(), '.claude', 'projects');

// ── ClaudeCodeRuntime ────────────────────────────────────────────

export class ClaudeCodeRuntime implements HarnessRuntime {
  readonly harnessId = 'claude-code';
  readonly protocol = 'cli' as const;
  private processes = new Map<string, ChildProcess>();

  constructor(
    readonly agentId: string,
    private config: HarnessConfig,
    private capabilities: AgentCapability[] = [],
    private logger?: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void },
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    const available = await this.detect();
    if (!available) {
      this.logger?.warn(`Claude Code agent ${this.agentId} not detected`);
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
      await this.execSimple('claude', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execSimple('npm', ['install', '-g', '@anthropic-ai/claude-code']);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  // ── Prompt Conversion ──────────────────────────────────────────
  //
  // Claude Code expects English, structured prompts that leverage
  // its tool-use capabilities. This converts Cabinet's Chinese format
  // to Claude Code's expected format.

  convertPrompt(task: ExternalTask, context?: HarnessContext): string {
    const slot = task.slot;
    const parts: string[] = [];

    // Inject harness skill first so Claude Code understands Cabinet protocol
    parts.push(this.injectSkill());
    parts.push('');
    parts.push('---');
    parts.push('');

    // Task description
    parts.push('## Task');
    const input = typeof task.input === 'string' ? task.input : JSON.stringify(task.input, null, 2);
    parts.push(input);
    parts.push('');

    // Project context
    if (slot.project?.name) {
      parts.push('## Project Context');
      parts.push(`- Project: ${slot.project.name}`);
      parts.push(`- Tech Stack: ${slot.project.tech_stack ?? 'unspecified'}`);
      if (slot.project.goals?.length) {
        parts.push(`- Goals: ${slot.project.goals.join(', ')}`);
      }
      parts.push('');
    }

    // Working directory context
    if (context?.workspacePath) {
      parts.push(`Working directory: ${context.workspacePath}`);
      parts.push('');
    }

    // Relevant memories
    if (slot.memories?.length) {
      parts.push('## Relevant Context');
      for (const m of slot.memories) {
        parts.push(`- ${m}`);
      }
      parts.push('');
    }

    // Relevant files
    if (slot.files?.length) {
      parts.push('## Related Files');
      for (const f of slot.files) {
        parts.push(`- ${f}`);
      }
      parts.push('');
    }

    // Security constraints
    parts.push('## Constraints');
    parts.push(`- Security Level: ${slot.security.level}`);
    parts.push(`- Max Retries: ${slot.security.maxRetries}`);
    if (slot.preferences) {
      parts.push(`- Risk Tolerance: ${slot.preferences.riskTolerance ?? 'moderate'}`);
      parts.push(`- Decision Style: ${slot.preferences.preferredDecisionStyle ?? 'autonomous'}`);
    }
    parts.push('');

    // Output protocol (use Cabinet markers for backward compat parsing)
    parts.push('## Output Protocol');
    parts.push('During execution, report intermediate findings using:');
    parts.push('```');
    parts.push(DISCOVERY_MARKER);
    parts.push('{"type": "<finding_type>", "summary": "<brief description>"}');
    parts.push(`${END_PREFIX}DISCOVERY===`);
    parts.push('```');
    parts.push('');
    parts.push('When the task is complete, wrap your final deliverable in:');
    parts.push('```');
    parts.push(DELIVERABLE_MARKER);
    parts.push('<final code, report, or result>');
    parts.push(`${END_PREFIX}DELIVERABLE===`);
    parts.push('```');
    parts.push('');
    parts.push('Use your available tools (Read, Write, Edit, Bash, Glob, Grep) to complete this task.');
    parts.push('If you need clarification, state your question clearly before proceeding.');

    return parts.join('\n');
  }

  // ── Output Parsing ─────────────────────────────────────────────

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

  // ── Metrics Extraction ─────────────────────────────────────────
  //
  // Claude Code outputs token/model info in its stderr/log output.
  // This attempts to parse those details.

  extractMetrics(stdout: string, stderr: string): AgentTaskMetrics {
    const combined = stdout + '\n' + stderr;
    const metrics: AgentTaskMetrics = {};

    // Try to find token usage: "tokens: 1234 input + 567 output"
    const tokenMatch = combined.match(/tokens?:\s*(\d[\d_,]*)\s*(?:input|prompt)?\s*\+\s*(\d[\d_,]*)\s*(?:output|completion)?/i);
    if (tokenMatch?.[1] && tokenMatch?.[2]) {
      metrics.tokensUsed = parseInt(tokenMatch[1].replace(/[_,]/g, ''), 10) +
                          parseInt(tokenMatch[2].replace(/[_,]/g, ''), 10);
    }

    // Try to find model info: "model: claude-sonnet-4-6" or "Using model claude-opus-4-8"
    const modelMatch = combined.match(/model:?\s*(claude[- ][\w.-]+)/i);
    if (modelMatch) {
      metrics.model = modelMatch[1];
    }

    // Try to find duration: "completed in 12.3s" or "duration: 45s"
    const durationMatch = combined.match(/(?:completed|duration|elapsed)[^0-9]*(\d+\.?\d*)\s*(s|sec|second)/i);
    if (durationMatch?.[1]) {
      metrics.durationMs = Math.round(parseFloat(durationMatch[1]) * 1000);
    }

    // Count tool calls from output
    const toolMatches = combined.match(/tool_use|using tool|Running:\s*\w/g);
    if (toolMatches) {
      metrics.toolCalls = toolMatches.length;
    }

    return metrics;
  }

  // ── Skill Injection ────────────────────────────────────────────

  injectSkill(): string {
    return [
      '# Cabinet Agent Protocol',
      '',
      'You are running as an external agent within the **Cabinet AI orchestration framework**.',
      '',
      '## How Cabinet Works',
      '- Cabinet dispatches tasks to you with project context, memories, and file references.',
      '- Your output is parsed by Cabinet and routed back to the main conversation.',
      '- You have access to your full tool set (Read, Write, Edit, Bash, Glob, Grep).',
      '',
      '## Communication Protocol',
      `- Report intermediate findings: wrap JSON in \`${DISCOVERY_MARKER}\\n{...}\\n${END_PREFIX}DISCOVERY===\``,
      `- Submit final deliverable: wrap in \`${DELIVERABLE_MARKER}\\n...\\n${END_PREFIX}DELIVERABLE===\``,
      '',
      '## Best Practices',
      '- Read files before editing them.',
      '- Use the working directory provided in the task for all file operations.',
      '- Report progress regularly using the discovery marker.',
      '- If the task is ambiguous, state your interpretation and proceed.',
      '- Do not modify files outside the working directory unless explicitly instructed.',
      '',
      '## Context Slot',
      'The task includes a "slot" with project info, memories, and preferences.',
      'Use this context to tailor your approach — it represents what Cabinet knows about the current project.',
    ].join('\n');
  }

  // ── Session Discovery ──────────────────────────────────────────
  //
  // Claude Code stores sessions as JSONL files. This discovers active sessions.

  async discoverSessions(): Promise<string[]> {
    const sessions: string[] = [];
    try {
      if (!existsSync(CLAUDE_SESSIONS_DIR)) return sessions;
      const { readdirSync } = await import('node:fs');
      const entries = readdirSync(CLAUDE_SESSIONS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionFile = join(CLAUDE_SESSIONS_DIR, entry.name, 'agent-*.jsonl');
          // Check if there are recent sessions (within last 24h)
          try {
            const files = readdirSync(join(CLAUDE_SESSIONS_DIR, entry.name));
            const recentSession = files.find((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
            if (recentSession) {
              sessions.push(`${entry.name}/${recentSession}`);
            }
          } catch { /* skip unreadable */ }
        }
      }
    } catch { /* best effort */ }
    return sessions;
  }

  // ── Task Dispatch ──────────────────────────────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    const timeoutMs = this.config.timeoutMs ?? task.configuration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();
    const command = this.config.command ?? 'claude';
    const args = [...(this.config.args ?? [])];

    // Add print mode for non-interactive execution
    if (!args.includes('--print') && !args.includes('-p')) {
      args.push('--print');
    }

    // Add working directory
    if (task.configuration.working_directory) {
      args.push('--cwd', task.configuration.working_directory);
    }

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
          else reject(new Error(`Claude Code exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
        });
        proc.on('error', (err) => {
          this.processes.delete(task.task_id);
          reject(err);
        });
      });

      if (this.logger) {
        this.logger.info(`Claude Code task ${task.task_id} completed`, {
          agentId: this.agentId,
          stdoutLen: stdout.length,
          stderrLen: stderr.length,
        });
      }

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
      { name: 'code_generation', description: 'Generate and edit code files' },
      { name: 'file_operations', description: 'Read, write, and manage files' },
      { name: 'shell_execution', description: 'Execute shell commands' },
      { name: 'code_review', description: 'Review and analyze code' },
      { name: 'refactoring', description: 'Refactor and improve existing code' },
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
