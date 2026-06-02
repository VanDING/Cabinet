export type StreamEvent =
  | { type: 'node:start'; nodeId: string }
  | { type: 'node:end'; nodeId: string; update: Record<string, unknown> }
  | { type: 'llm:chunk'; nodeId: string; content: string }
  | { type: 'llm:thinking'; nodeId: string; content: string }
  | { type: 'tool:call'; nodeId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool:result'; nodeId: string; toolName: string; result: unknown }
  | { type: 'checkpoint:saved'; checkpointId: string }
  | { type: 'error'; nodeId: string; error: string };
