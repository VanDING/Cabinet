//
// HarnessRuntime — per-harness adapter abstraction for external agents.
//
// Each external agent harness (Claude Code, Codex, OpenCode, A2A, Generic CLI)
// implements this interface. The HarnessRuntimeFactory creates the correct
// runtime based on harnessId, and AgentDaemon injects harnessContext into
// tasks before dispatch.
//
// This replaces the "one-size-fits-all" CliAdapter with harness-aware execution:
//   - Claude Code → Anthropic tool-use format + session discovery
//   - Codex       → OpenAI function-calling format
//   - OpenCode    → SQLite DB + Markdown output
//   - A2A         → WebSocket bidirectional + HarnessSkill injection
//   - Generic     → Fallback (current CliAdapter behavior)
//

import type {
  ExternalAgentAdapter,
  ExternalTask,
  ExternalTaskResult,
  AgentCapability,
} from './types.js';

// ── Harness-specific task metrics ─────────────────────────────────

export interface AgentTaskMetrics {
  /** Total tokens consumed (prompt + completion). */
  tokensUsed?: number;
  /** Context window utilization percentage (0–100). */
  contextWindowPercent?: number;
  /** Model identifier used for this task. */
  model?: string;
  /** Number of tool calls made by the agent. */
  toolCalls?: number;
  /** Number of reasoning/execution steps. */
  steps?: number;
  /** Time to first token in milliseconds. */
  ttftMs?: number;
  /** Total wall-clock duration in milliseconds. */
  durationMs?: number;
}

// ── Harness context injected into task slot ────────────────────────

export interface HarnessContext {
  /** Which harness is executing (claude-code, codex, opencode, a2a, generic). */
  harnessId: string;
  /** Communication protocol. */
  protocol: 'cli' | 'a2a';
  /** Harness-specific output format description. */
  outputFormat: string;
  /** Permission/profile configuration for this harness. */
  permissionProfile?: 'auto' | 'conservative' | 'acceptEdits' | 'bypassPermissions';
  /** Path to the harness skill file for protocol injection. */
  skillPath?: string;
  /** Working directory for the harness execution. */
  workspacePath?: string;
  /** Model override for this execution. */
  model?: string;
}

// ── HarnessRuntime interface ──────────────────────────────────────

export interface HarnessRuntime extends ExternalAgentAdapter {
  /** Unique harness identifier (e.g. 'claude-code', 'codex', 'a2a'). */
  readonly harnessId: string;

  /** Convert a Cabinet ExternalTask to harness-native prompt text. */
  convertPrompt(task: ExternalTask, context?: HarnessContext): string;

  /** Parse harness stdout/stderr back into a Cabinet ExternalTaskResult. */
  parseOutput(
    stdout: string,
    stderr: string,
    taskId: string,
    startedAt: string,
  ): ExternalTaskResult;

  /** Extract harness-specific metrics from execution output. */
  extractMetrics?(stdout: string, stderr: string): AgentTaskMetrics;

  /** Return the SKILL.md content to inject into the agent's context. */
  injectSkill(): string;

  /** Discover active/running sessions for this harness (if supported). */
  discoverSessions?(): Promise<string[]>;

  /** Get the underlying adapter for direct access (backward compat). */
  getAdapter?(): ExternalAgentAdapter;
}

// ── Harness config (for factory construction) ──────────────────────

export interface HarnessConfig {
  /** Harness identifier. */
  harnessId: string;
  /** Dispatch protocol override (acp/headless/terminal-only). */
  dispatchProtocol?: string;
  /** CLI command (for CLI-based harnesses). */
  command?: string;
  /** CLI arguments. */
  args?: string[];
  /** Environment variables. */
  env?: Record<string, string>;
  /** Permission mode. */
  permissionMode?: 'auto' | 'conservative';
  /** A2A base URL (for A2A harness). */
  baseUrl?: string;
  /** A2A health check URL. */
  healthCheckUrl?: string;
  /** A2A auth config. */
  authConfig?: { type: 'api_key' | 'oauth'; header?: string; envVar?: string };
  /** Timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum retries. */
  maxRetries?: number;
  /** Agent capabilities. */
  capabilities?: AgentCapability[];
}
