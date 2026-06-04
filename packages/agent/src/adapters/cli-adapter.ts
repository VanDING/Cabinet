//
// CLI Adapter — config-driven adapter for CLI-based agents (Claude Code, Codex, etc.).
//
// A single CliAdapter class handles all CLI agents; different agents are
// differentiated by CliAgentConfig (command, args, env, permissionMode, etc.).
//
// Three interaction modes:
//   Mode A: Single request-response via stdin/stdout (--print mode)
//   Mode B: Interactive PTY terminal (handled by frontend + Tauri Rust layer)
//   Mode C: Hooks-driven async (future — Claude Code hooks beta)
//
// This adapter implements Mode A. Mode B is in Phase 3 (terminal integration).
//

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type {
  ExternalAgentAdapter,
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
  CliAgentConfig,
} from './types.js';

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DELIVERABLE_MARKER = '===CABINET_DELIVERABLE===';
const DISCOVERY_MARKER = '===CABINET_DISCOVERY===';
const END_MARKER = '===END_';

// ── Prompt Rendering ─────────────────────────────────────────────

function renderPrompt(task: ExternalTask): string {
  const slot = task.slot;
  const lines: string[] = [
    `## 任务`,
    typeof task.input === 'string' ? task.input : JSON.stringify(task.input, null, 2),
    '',
  ];

  if (slot.project?.name) {
    lines.push(
      `## 项目上下文`,
      `- 项目: ${slot.project.name}`,
      `- 技术栈: ${slot.project.tech_stack ?? '未指定'}`,
      `- 目标: ${slot.project.goals?.join(', ') ?? '未指定'}`,
      '',
    );
  }

  if (slot.memories?.length) {
    lines.push('## 相关记忆', ...slot.memories.map((m) => `- ${m}`), '');
  }

  if (slot.files?.length) {
    lines.push('## 最近文件', ...slot.files.map((f) => `- ${f}`), '');
  }

  if (slot.preferences) {
    lines.push(
      '## Captain 偏好',
      `- 风险容忍度: ${slot.preferences.riskTolerance ?? '未指定'}`,
      `- 决策风格: ${slot.preferences.preferredDecisionStyle ?? '未指定'}`,
      '',
    );
  }

  lines.push(
    '## 安全约束',
    `- 安全级别: ${slot.security.level}`,
    `- 最大重试次数: ${slot.security.maxRetries}`,
    '',
    '## 输出协议（严格遵守）',
    '执行过程中如有中间发现，用分隔符标记：',
    `${DISCOVERY_MARKER}`,
    `{"type": "...", "summary": "..."}`,
    `${END_MARKER}DISCOVERY===`,
    '',
    '任务完成时，用分隔符标记最终交付物：',
    `${DELIVERABLE_MARKER}`,
    '<最终代码/报告/结果>',
    `${END_MARKER}DELIVERABLE===`,
  );

  return lines.join('\n');
}

// ── Output Parsing ───────────────────────────────────────────────

function extractTaggedSections(stdout: string, marker: string): string[] {
  const results: string[] = [];
  const startTag = marker;
  const endTag = `===END_${marker.replace(/^===/, '')}===`;

  let searchFrom = 0;
  while (searchFrom < stdout.length) {
    const start = stdout.indexOf(startTag, searchFrom);
    if (start === -1) break;
    const contentStart = start + startTag.length;
    const end = stdout.indexOf(endTag, contentStart);
    if (end === -1) break;
    results.push(stdout.slice(contentStart, end).trim());
    searchFrom = end + endTag.length;
  }
  return results;
}

function extractDeliverable(stdout: string): string | undefined {
  const sections = extractTaggedSections(stdout, DELIVERABLE_MARKER);
  return sections.length > 0 ? sections[sections.length - 1] : undefined;
}

function parseOutput(stdout: string, taskId: string, startedAt: string): ExternalTaskResult {
  const discoveries = extractTaggedSections(stdout, DISCOVERY_MARKER).map((d) => {
    try {
      return JSON.parse(d) as { type: string; summary: string; [key: string]: unknown };
    } catch {
      return { type: 'text', summary: d.trim() };
    }
  });
  const deliverable = extractDeliverable(stdout);

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

// ── Process Helpers ──────────────────────────────────────────────

function readStream(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    stream.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function collectStderr(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return new Promise((resolve) => {
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', () => resolve('')); // stderr errors are non-fatal
  });
}

// ── CliAdapter ───────────────────────────────────────────────────

export class CliAdapter implements ExternalAgentAdapter {
  readonly protocol = 'cli' as const;
  private processes = new Map<string, ChildProcess>();

  constructor(
    readonly agentId: string,
    private config: CliAgentConfig,
    private capabilities: AgentCapability[] = [],
    private logger?: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void },
  ) {}

  async start(): Promise<void> {
    const available = await this.detect();
    if (!available) {
      this.logger?.warn(`CLI agent ${this.agentId} not detected`, { command: this.config.command });
    }
  }

  async stop(): Promise<void> {
    for (const [taskId, proc] of this.processes) {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
    }
    this.processes.clear();
  }

  async healthCheck(): Promise<boolean> {
    return this.detect();
  }

  // ── Detection & Installation ────────────────────────────────

  async detect(): Promise<boolean> {
    if (!this.config.detectCommand) {
      // Fall back to checking if the command exists
      try {
        await this.execSimple(this.config.command, ['--version']);
        return true;
      } catch {
        return false;
      }
    }
    try {
      await this.execSimple('sh', ['-c', this.config.detectCommand]);
      return true;
    } catch {
      return false;
    }
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    if (!this.config.installCommand) {
      return { success: false, error: 'No install command configured' };
    }
    try {
      await this.execSimple('sh', ['-c', this.config.installCommand]);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
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

  // ── Task Dispatch (Mode A: stdin/stdout) ────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    const timeoutMs = this.config.timeoutMs ?? task.configuration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();

    try {
      const prompt = renderPrompt(task);

      const proc = spawn(this.config.command, this.config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...this.config.env },
        cwd: task.configuration.working_directory ?? process.cwd(),
        timeout: timeoutMs,
      });

      this.processes.set(task.task_id, proc);

      // Write prompt to stdin
      proc.stdin!.write(prompt);
      proc.stdin!.end();

      // Read stdout and stderr concurrently
      const [stdout, stderr] = await Promise.all([
        readStream(proc.stdout!, timeoutMs),
        collectStderr(proc.stderr!),
      ]);

      // Wait for process to exit
      await new Promise<void>((resolve, reject) => {
        proc.on('close', (code) => {
          this.processes.delete(task.task_id);
          if (code === 0 || code === null) resolve();
          else reject(new Error(`Process exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
        });
        proc.on('error', (err) => {
          this.processes.delete(task.task_id);
          reject(err);
        });
      });

      if (stderr && this.logger) {
        this.logger.info(`CLI agent ${this.agentId} stderr`, { taskId: task.task_id, stderr: stderr.slice(0, 200) });
      }

      return parseOutput(stdout, task.task_id, startedAt);
    } catch (err) {
      this.processes.delete(task.task_id);
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = message.includes('timed out');

      return {
        task_id: task.task_id,
        status: isTimeout ? 'timed_out' : 'failed',
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
    return this.capabilities;
  }
}
