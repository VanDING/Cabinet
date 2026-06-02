/**
 * Frontend-local mirror of AgentEvent from @cabinet/events.
 * Kept inline to avoid pulling Node-specific dependencies into the browser bundle.
 */
export type AgentEvent =
  | { type: 'thinking'; content: string; timestamp: number }
  | { type: 'tool_call'; name: string; args: unknown; timestamp: number }
  | { type: 'tool_result'; name: string; result: unknown; timestamp: number }
  | { type: 'stream_chunk'; content: string; timestamp: number }
  | { type: 'output'; content: string; timestamp: number }
  | { type: 'started'; timestamp: number }
  | { type: 'user_input_received'; content: string; timestamp: number }
  | { type: 'completed'; deliverable?: unknown; timestamp: number }
  | { type: 'error'; message: string; timestamp: number }
  | { type: 'status'; status: 'running' | 'waiting_for_user' | 'completed' | 'error'; timestamp: number };
