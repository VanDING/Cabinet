//
// @cabinet/agent-sdk — SDK for building external agents compatible with Cabinet.
//
// Usage:
//   import { SlotClient, createAgentCard, connectToCabinet } from '@cabinet/agent-sdk';
//

export type {
  ContextSlot,
  ExternalAgentConfig,
  ExternalAgentProtocol,
  AgentConfigSource,
} from './types.js';

export {
  SlotClient,
  type SlotClientConfig,
  type TelemetryPayload,
} from './slot-client.js';

export {
  createAgentCard,
  agentCardResponse,
  parseTask,
  taskResultResponse,
  connectToCabinet,
  type A2AAgentCard,
  type A2ATask,
  type A2ATaskResult,
  type CabinetWSClient,
} from './a2a-helper.js';
