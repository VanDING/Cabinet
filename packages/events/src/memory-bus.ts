import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';
import { buildCausationChain } from './causation.js';
import { DeadLetterQueue } from './dead-letter.js';

const MAX_EVENTS = 1000;

export class MemoryEventBus implements EventBus {
  private readonly subscribers = new Map<
    MessageType,
    Set<{ handler: MessageHandler; name: string }>
  >();
  private readonly events: MessageEnvelope[] = [];
  readonly deadLetterQueue = new DeadLetterQueue();

  constructor() {
    this.deadLetterQueue.setRetryBus(this);
  }

  async publish(envelope: MessageEnvelope): Promise<void> {
    // Immutable append
    this.events.push(Object.freeze({ ...envelope }));

    // Ring buffer: evict oldest events when above limit
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }

    const subs = this.subscribers.get(envelope.messageType);
    if (subs) {
      for (const { handler, name } of subs) {
        try {
          await handler(envelope);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(`[MemoryEventBus] Handler error (${name}): ${error.message}`);
          this.deadLetterQueue.enqueue({
            envelope,
            error: error.message,
            stack: error.stack,
            handlerName: name,
            messageType: envelope.messageType,
            failedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  subscribe(messageType: MessageType, handler: MessageHandler, name?: string): void {
    let subs = this.subscribers.get(messageType);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(messageType, subs);
    }
    const entryName = name ?? (handler.name || 'anonymous');
    for (const existing of subs) {
      if (existing.handler === handler) return;
    }
    subs.add({ handler, name: entryName });
  }

  once(messageType: MessageType, handler: MessageHandler, name?: string): void {
    const wrapped: MessageHandler = (msg) => {
      this.unsubscribe(messageType, wrapped);
      return handler(msg);
    };
    this.subscribe(messageType, wrapped, name ?? (handler.name || 'anonymous'));
  }

  unsubscribe(messageType: MessageType, handler: MessageHandler): void {
    const subs = this.subscribers.get(messageType);
    if (subs) {
      for (const entry of [...subs]) {
        if (entry.handler === handler) {
          subs.delete(entry);
        }
      }
    }
  }

  dispose(): void {
    this.subscribers.clear();
    this.events.length = 0;
  }

  async getCausationChain(correlationId: string): Promise<MessageEnvelope[]> {
    const filtered = this.events.filter((e) => e.correlationId === correlationId);
    if (filtered.length === 0) return [];
    const childIds = new Set(filtered.map((e) => e.causationId).filter(Boolean) as string[]);
    const leaf = filtered.find((e) => !childIds.has(e.messageId));
    if (!leaf) return filtered;
    return buildCausationChain(leaf.messageId, filtered);
  }

  /**
   * Replay buffered events to a handler. Returns the number of events replayed.
   * Note: only events still in the ring buffer (last 1000) are available.
   */
  async replay(since: Date, handler: MessageHandler, messageType?: MessageType): Promise<number> {
    const filtered = this.events.filter((e) => {
      if (e.timestamp < since) return false;
      if (messageType && e.messageType !== messageType) return false;
      return true;
    });
    let count = 0;
    for (const event of filtered) {
      try {
        await handler(event);
        count++;
      } catch {
        // Skip events that fail during replay
      }
    }
    return count;
  }

  /** Get all published events (for testing and debugging only) */
  getAllEvents(): readonly MessageEnvelope[] {
    return [...this.events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}
