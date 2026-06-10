export type {
  ExternalAgentAdapter,
  ExternalTask,
  ExternalTaskResult,
  TelemetryReport,
  AgentCapability,
  CliAgentConfig,
  A2AAgentConfig,
} from './types.js';

export type {
  HarnessRuntime,
  HarnessContext,
  HarnessConfig,
  AgentTaskMetrics,
} from './harness-runtime.js';

/** @deprecated Use HarnessRuntimeFactory or GenericCliRuntime directly. */
export { CliAdapter } from './cli-adapter.js';

/** @deprecated Use A2AHarnessRuntime or HarnessRuntimeFactory directly. */
export { A2AConnector } from './harness/a2a.js';

export {
  TaskIdempotencyGuard,
  approvalCallbackWithRetry,
  transitionTask,
  canTransition,
  type CallbackResult,
  type TaskRecord,
  type TaskReliabilityStatus,
  VALID_TRANSITIONS,
} from './task-reliability.js';

// Harness
export {
  ClaudeCodeRuntime,
  CodexRuntime,
  OpenCodeRuntime,
  A2AHarnessRuntime,
  GenericCliRuntime,
  HarnessRuntimeFactory,
  HARNESS_IDS,
  type HarnessId,
} from './harness/index.js';
