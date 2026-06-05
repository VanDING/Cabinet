//
// Generic CLI HarnessRuntime — fallback for unrecognized CLI agents.
//
// Mirrors the original CliAdapter behavior: Cabinet internal prompt format
// with ===CABINET_DELIVERABLE=== markers. Used when no specific harness
// (Claude Code, Codex, OpenCode) is detected.
//

import { spawn, type ChildProcess } from 'node:child_process';
import type {
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
} from '../types.js';
import type { HarnessRuntime, HarnessContext, AgentTaskMetrics, HarnessConfig } from '../harness-runtime.js';

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;
const DELIVERABLE_MARKER = '===CABINET_DELIVERABLE===';
const DISCOVERY_MARKER = '===CABINET_DISCOVERY===';
const END_PREFIX = '===END_';

// ── GenericCliRuntime ─────────────────────────────────────────────

export class GenericCliRuntime implements HarnessRuntime {
  readonly harnessId = 'generic';
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
      this.logger?.warn(`Generic CLI agent ${this.agentId} not detected`, { command: this.config.command });
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

  // ── Detection ──────────────────────────────────────────────────

  async detect(): Promise<boolean> {
    if (!this.config.command) return false;
    try {
      await this.execSimple(this.config.command, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'No install command for generic harness' };
  }

  // ── Prompt Conversion ──────────────────────────────────────────

  convertPrompt(task: ExternalTask, _context?: HarnessContext): string {
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
      `${END_PREFIX}DISCOVERY===`,
      '',
      '任务完成时，用分隔符标记最终交付物：',
      `${DELIVERABLE_MARKER}`,
      '<最终代码/报告/结果>',
      `${END_PREFIX}DELIVERABLE===`,
    );

    return lines.join('\n');
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

  extractMetrics(stdout: string, _stderr: string): AgentTaskMetrics {
    // Generic harness can't extract detailed metrics
    return {
      tokensUsed: undefined,
      contextWindowPercent: undefined,
      model: undefined,
      toolCalls: undefined,
      steps: undefined,
      durationMs: undefined,
    };
  }

  // ── Skill Injection ────────────────────────────────────────────

  injectSkill(): string {
    // Generic harness injects basic Cabinet protocol instructions
    return [
      '## Cabinet 协议',
      '你正在 Cabinet AI 编排框架中运行。',
      '',
      '### 输出格式',
      `- 中间发现: 用 \`${DISCOVERY_MARKER}\\n{...}\\n${END_PREFIX}DISCOVERY===\` 包裹`,
      `- 最终交付: 用 \`${DELIVERABLE_MARKER}\\n...\\n${END_PREFIX}DELIVERABLE===\` 包裹`,
      '',
      '### Context Slot',
      '如果任务包含 context slot，你可以读取其中的文件、记忆、偏好等信息。',
      '完成后的交付物会通过 slot 回传到 Cabinet 主系统。',
      '',
      '### 约束',
      '- 不要修改 slot_write_url 指向的文件',
      '- 所有文件操作在工作目录内进行',
      '- 超时后任务会自动取消',
    ].join('\n');
  }

  // ── Task Dispatch ──────────────────────────────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    const timeoutMs = this.config.timeoutMs ?? task.configuration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();
    const command = this.config.command ?? this.agentId;
    const args = this.config.args ?? [];

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
          else reject(new Error(`Process exited with code ${code}. stderr: ${stderr.slice(0, 500)}`));
        });
        proc.on('error', (err) => {
          this.processes.delete(task.task_id);
          reject(err);
        });
      });

      if (stderr && this.logger) {
        this.logger.info(`Generic CLI agent ${this.agentId} stderr`, { taskId: task.task_id, stderr: stderr.slice(0, 200) });
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
    return this.capabilities;
  }

  // ── Private helpers ────────────────────────────────────────────

  private extractTaggedSections(stdout: string, marker: string): string[] {
    const results: string[] = [];
    const startTag = marker;
    const endTag = `${END_PREFIX}${marker.replace(/^===/, '')}===`;
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
