export type {
  ExternalAgentAdapter,
  ExternalTask,
  ExternalTaskResult,
  TelemetryReport,
  AgentCapability,
  CliAgentConfig,
  A2AAgentConfig,
} from './types.js';

export { CliAdapter } from './cli-adapter.js';
export { A2AConnector } from './a2a-connector.js';
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
