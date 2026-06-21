import { EventEmitter } from 'node:events';

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
  | {
      type: 'status';
      status: 'running' | 'waiting_for_user' | 'completed' | 'error';
      timestamp: number;
    };

export interface AgentEventStore {
  appendEvent(sessionId: string, event: AgentEvent): void;
  getEvents(sessionId: string): AgentEvent[];
  setDeliverable(sessionId: string, deliverable: unknown): void;
  getDeliverable(sessionId: string): unknown | undefined;
}

export type BroadcastFn = (type: string, data?: Record<string, unknown>) => void;

export type ParentNotificationFn = (parentSessionId: string, deliverable: unknown) => void;

/**
 * Dual-track event bus for sub-agent execution events.
 *
 * Track A: WebSocket broadcast to frontend (real-time sub-window rendering)
 * Track B: Persist to SQLite via AgentEventStore
 * Track C: Notify parent session when sub-agent completes
 */
export class AgentEventBus extends EventEmitter {
  constructor(
    private broadcast: BroadcastFn,
    private store: AgentEventStore,
    private notifyParent: ParentNotificationFn,
  ) {
    super();
  }

  publish(sessionId: string, parentSessionId: string | undefined, event: AgentEvent): void {
    // Track A: WebSocket push to frontend
    this.broadcast('agent_event', { sessionId, event });

    // Track B: Persist to store
    this.store.appendEvent(sessionId, event);

    // Track C: Notify parent on completion
    if (event.type === 'completed' && parentSessionId) {
      this.notifyParent(parentSessionId, event.deliverable);
    }

    // Also emit locally for in-process subscribers
    this.emit('event', sessionId, event);
  }

  getEvents(sessionId: string): AgentEvent[] {
    return this.store.getEvents(sessionId);
  }
}
