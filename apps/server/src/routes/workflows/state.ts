import type { WorkflowCapabilities } from '@cabinet/types';
import { AgentLoop, ToolExecutor } from '@cabinet/agent';

// ── ToolExecutor cache (keyed by capability JSON hash) ──
export const toolExecutorCache = new Map<string, ToolExecutor>();

// ── AgentLoop instance pool (keyed by runId:agentId, LRU eviction, max 10) ──
export const AGENT_LOOP_POOL_MAX = 10;
export const agentLoopPool = new Map<string, AgentLoop>();

// ── Capabilities cache (workflowId → capabilities declared in definition) ──
export const capabilityCache = new Map<string, WorkflowCapabilities>();
// Pending capabilities for the currently-starting workflow (set before startRun, read in createAgentLoop)
export let pendingCapabilities: WorkflowCapabilities = {};

export function setPendingCapabilities(caps: WorkflowCapabilities): void {
  pendingCapabilities = caps;
}

/** Helper: return a stub that throws with a capabilities-gated message, matching the expected return type. */
export function stub<T>(feature: string): T {
  const msg = `${feature} not enabled. Add "capabilities" to workflow definition.`;
  return (async () => {
    throw new Error(msg);
  }) as unknown as T;
}
