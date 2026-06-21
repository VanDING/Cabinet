//
// BaseCliRuntime — shared base for all CLI HarnessRuntimes.
//
// Extracts ~192 lines of duplicated helpers, lifecycle, and dispatch
// logic from GenericCliRuntime, CodexRuntime, OpenCodeRuntime, and
// ClaudeCodeRuntime.
//

import { type ChildProcess } from 'node:child_process';
import { spawnCrossPlatform } from '../../utils/spawn.js';
import type { ExternalTask, ExternalTaskResult, AgentCapability } from '../types.js';
import type {
  HarnessRuntime,
  HarnessContext,
  AgentTaskMetrics,
  HarnessConfig,
} from '../harness-runtime.js';

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 300_000;
const DELIVERABLE_MARKER = '===CABINET_DELIVERABLE===';
const DISCOVERY_MARKER = '===CABINET_DISCOVERY===';
const END_PREFIX = '===END_';

// ── BaseCliRuntime ───────────────────────────────────────────────

export abstract class BaseCliRuntime implements HarnessRuntime {
  readonly protocol = 'cli' as const;
  abstract readonly harnessId: string;

  private processes = new Map<string, ChildProcess>();

  constructor(
    readonly agentId: string,
    protected config: HarnessConfig,
    protected capabilities: AgentCapability[] = [],
    protected logger?: {
      info: (msg: string, ctx?: unknown) => void;
      warn: (msg: string, ctx?: unknown) => void;
    },
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    const available = await this.detect();
    if (!available) {
      this.logger?.warn(`${this.constructor.name} agent ${this.agentId} not detected`, {
        command: this.config.command,
      });
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
    const command = this.config.command ?? this.getDefaultCommand();
    if (!command) return false;
    try {
      await this.execSimple(command, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: `No install command for ${this.harnessId} harness` };
  }

  // ── Abstract hooks (subclass-specific) ─────────────────────────

  protected abstract getDefaultCommand(): string;
  protected abstract buildArgs(task: ExternalTask): string[];
  abstract convertPrompt(task: ExternalTask, context?: HarnessContext): string;
  abstract extractMetrics(stdout: string, stderr: string): AgentTaskMetrics;
  abstract injectSkill(): string;

  discoverSessions?(): Promise<string[]>;

  // ── Output Parsing ─────────────────────────────────────────────

  parseOutput(
    stdout: string,
    _stderr: string,
    taskId: string,
    startedAt: string,
  ): ExternalTaskResult {
    const discoveries = this.extractTaggedSections(stdout, DISCOVERY_MARKER).map((d) => {
      try {
        return JSON.parse(d) as { type: string; summary: string; [key: string]: unknown };
      } catch {
        return { type: 'text', summary: d.trim() };
      }
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

  // ── Task Dispatch ──────────────────────────────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    const timeoutMs = this.config.timeoutMs ?? task.configuration.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();
    const command = this.config.command ?? this.getDefaultCommand();
    const args = this.buildArgs(task);

    try {
      const prompt = this.convertPrompt(task);

      const proc = spawnCrossPlatform(command, args, {
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
          else
            reject(
              new Error(
                `${this.harnessId} exited with code ${code}. stderr: ${stderr.slice(0, 500)}`,
              ),
            );
        });
        proc.on('error', (err) => {
          this.processes.delete(task.task_id);
          reject(err);
        });
      });

      if (stderr && this.logger) {
        this.logger.info(`${this.harnessId} task ${task.task_id} completed`, {
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
      const timer = setTimeout(
        () => reject(new Error(`Process timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
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

  private collectStderr(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    return new Promise((resolve) => {
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', () => resolve(''));
    });
  }

  protected execSimple(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawnCrossPlatform(command, args, {
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
