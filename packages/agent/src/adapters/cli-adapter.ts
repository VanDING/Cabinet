//
// CLI Adapter — config-driven facade for CLI-based agents.
//
// This is now a facade that auto-detects the correct HarnessRuntime
// (Claude Code, Codex, OpenCode, or Generic) and delegates all operations.
//
// The original CliAdapter logic lives in GenericCliRuntime (harness/generic.ts).
// This facade preserves backward compatibility — existing code that creates
// CliAdapter directly continues to work, but now gets harness-aware execution.
//

import type {
  ExternalAgentAdapter,
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
  CliAgentConfig,
} from './types.js';
import type { HarnessRuntime, HarnessConfig } from './harness-runtime.js';
import { HarnessRuntimeFactory } from './harness/factory.js';

// ── CliAdapter (Facade) ──────────────────────────────────────────
// @deprecated Use HarnessRuntimeFactory or GenericCliRuntime directly.

/** @deprecated Use HarnessRuntimeFactory or GenericCliRuntime directly. */
export class CliAdapter implements ExternalAgentAdapter {
  readonly protocol = 'cli' as const;
  private runtime: HarnessRuntime;

  constructor(
    readonly agentId: string,
    private config: CliAgentConfig,
    private capabilities: AgentCapability[] = [],
    private logger?: {
      info: (msg: string, ctx?: unknown) => void;
      warn: (msg: string, ctx?: unknown) => void;
    },
  ) {
    // Auto-detect harness from command name and create the appropriate runtime
    const harnessConfig: HarnessConfig = {
      harnessId: HarnessRuntimeFactory.detectFromCommand(config.command),
      command: config.command,
      args: config.args,
      env: config.env,
      permissionMode: config.permissionMode,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      capabilities,
    };

    this.runtime = HarnessRuntimeFactory.create(agentId, harnessConfig, capabilities, logger);
  }

  // ── Delegated lifecycle ────────────────────────────────────────

  async start(): Promise<void> {
    return this.runtime.start();
  }

  async stop(): Promise<void> {
    return this.runtime.stop();
  }

  async healthCheck(): Promise<boolean> {
    return this.runtime.healthCheck();
  }

  // ── Delegated detection ────────────────────────────────────────

  async detect(): Promise<boolean> {
    return (this.runtime as any).detect?.() ?? this.runtime.healthCheck();
  }

  async install(): Promise<{ success: boolean; error?: string }> {
    return (this.runtime as any).install?.() ?? { success: false, error: 'Not supported' };
  }

  // ── Delegated task dispatch ────────────────────────────────────

  async dispatchTask(task: ExternalTask): Promise<ExternalTaskResult> {
    return this.runtime.dispatchTask(task);
  }

  async cancelTask(taskId: string): Promise<void> {
    return this.runtime.cancelTask?.(taskId);
  }

  // ── Capabilities ───────────────────────────────────────────────

  getCapabilities(): AgentCapability[] {
    return this.runtime.getCapabilities();
  }

  // ── Harness access ─────────────────────────────────────────────

  /** Get the underlying HarnessRuntime for direct access. */
  getRuntime(): HarnessRuntime {
    return this.runtime;
  }

  /** Get the detected harness ID. */
  getHarnessId(): string {
    return this.runtime.harnessId;
  }

  /** Get the harness-specific skill injection text. */
  getSkillInjection(): string {
    return this.runtime.injectSkill();
  }
}
