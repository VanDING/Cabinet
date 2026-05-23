import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';
import { buildCausationChain } from './causation.js';

const MAX_EVENTS = 1000;

export class MemoryEventBus implements EventBus {
  private readonly subscribers = new Map<MessageType, Set<MessageHandler>>();
  private readonly events: MessageEnvelope[] = [];

  async publish(envelope: MessageEnvelope): Promise<void> {
    // Immutable append
    this.events.push(Object.freeze({ ...envelope }));

    // Ring buffer: evict oldest events when above limit
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }

    const handlers = this.subscribers.get(envelope.messageType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(envelope);
        } catch {
          // Isolate handler errors so one failing subscriber doesn't block others
        }
      }
    }
  }

  subscribe(messageType: MessageType, handler: MessageHandler): void {
    let handlers = this.subscribers.get(messageType);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(messageType, handlers);
    }
    handlers.add(handler);
  }

  unsubscribe(messageType: MessageType, handler: MessageHandler): void {
    this.subscribers.get(messageType)?.delete(handler);
  }

  async getCausationChain(correlationId: string): Promise<MessageEnvelope[]> {
    const filtered = this.events.filter((e) => e.correlationId === correlationId);
    if (filtered.length === 0) return [];
    const childIds = new Set(filtered.map((e) => e.causationId).filter(Boolean) as string[]);
    const leaf = filtered.find((e) => !childIds.has(e.messageId));
    if (!leaf) return filtered;
    return buildCausationChain(leaf.messageId, filtered);
  }

  /** Get all published events (for testing and debugging only) */
  getAllEvents(): readonly MessageEnvelope[] {
    return [...this.events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}
