import type { MessageEnvelope, MessageType } from '@cabinet/types';

export type MessageHandler = (message: MessageEnvelope) => void | Promise<void>;

export interface EventBus {
  /** Publish an event. Events are immutable and append-only. */
  publish(envelope: MessageEnvelope): Promise<void>;

  /**
   * Subscribe to a specific message type.
   * @param name Optional human-readable label for this handler (used in DLQ diagnostics).
   */
  subscribe(messageType: MessageType, handler: MessageHandler, name?: string): void;

  /** Subscribe to a single event, then automatically unsubscribe. */
  once(messageType: MessageType, handler: MessageHandler, name?: string): void;

  /** Unsubscribe a previously registered handler. */
  unsubscribe(messageType: MessageType, handler: MessageHandler): void;

  /**
   * Replay historical events to a handler. Returns the number of events replayed.
   * For persistent stores, replays from the log; for in-memory, replays from the ring buffer.
   */
  replay(since: Date, handler: MessageHandler, messageType?: MessageType): Promise<number>;

  /** Query the causal chain for a given correlationId, returning events from root to leaf. */
  getCausationChain(correlationId: string): Promise<MessageEnvelope[]>;

  /** Remove all subscribers and release resources. */
  dispose(): void;
}
