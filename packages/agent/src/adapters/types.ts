//
// External Agent Adapter Types
//
// Unified interfaces for dispatching tasks to external agents (A2A or CLI).
// All adapters implement ExternalAgentAdapter regardless of protocol.
//

import type { ContextSlot, ExternalAgentConfig } from '@cabinet/types';

// ── Agent Capability ────────────────────────────────────────────

export interface AgentCapability {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  security_level?: 'read_only' | 'light_write' | 'moderate' | 'cost' | 'destructive';
}

// ── External Task ───────────────────────────────────────────────

export interface ExternalTask {
  task_id: string;
  session_id: string;
  capability: string;
  input: unknown;
  slot: ContextSlot;
  configuration: {
    max_retries: number;
    timeout_ms: number;
    slot_write_url: string;
    working_directory?: string;
  };
}

// ── Task Result ─────────────────────────────────────────────────

export interface ExternalTaskResult {
  task_id: string;
  status: 'completed' | 'failed' | 'awaiting_approval' | 'timed_out';
  output?: unknown;
  discoveries?: Array<{ type: string; summary: string; [key: string]: unknown }>;
  decision_id?: string;
  error?: string;
  audit: {
    started_at: string;
    completed_at: string;
    tokens_used?: number;
    model?: string;
  };
}

// ── Telemetry Report ────────────────────────────────────────────

export interface TelemetryReport {
  task_id: string;
  agent_id: string;
  model: string;
  tokens: { prompt: number; completion: number };
  timing: {
    ttft_ms: number;
    total_ms: number;
    tool_latency_ms: number[];
  };
  steps: number;
  status: 'completed' | 'failed';
}

// ── CLI Agent Config ────────────────────────────────────────────

export interface CliAgentConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  permissionMode?: 'auto' | 'conservative';
  detectCommand?: string;
  installCommand?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

// ── A2A Agent Config ────────────────────────────────────────────

export interface A2AAgentConfig {
  baseUrl: string;
  healthCheckUrl?: string;
  cabinetWsUrl?: string;  // Cabinet WebSocket endpoint for real-time events
  authConfig?: { type: 'api_key' | 'oauth'; header?: string; envVar?: string };
  timeoutMs?: number;
  maxRetries?: number;
}

// ── Adapter Interface ───────────────────────────────────────────

export interface ExternalAgentAdapter {
  readonly agentId: string;
  readonly protocol: 'a2a' | 'cli';

  /** Start the adapter (connect to A2A service or verify CLI availability). */
  start(): Promise<void>;

  /** Stop the adapter (close connections, clean up processes). */
  stop(): Promise<void>;

  /** Check if the agent is currently reachable / running. */
  healthCheck(): Promise<boolean>;

  /** Dispatch a task to the external agent and wait for the result. */
  dispatchTask(task: ExternalTask): Promise<ExternalTaskResult>;

  /** Cancel a running task (best-effort). */
  cancelTask?(taskId: string): Promise<void>;

  /** List capabilities declared by this agent. */
  getCapabilities(): AgentCapability[];
}
