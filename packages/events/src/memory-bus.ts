import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';

export class MemoryEventBus implements EventBus {
  private readonly subscribers = new Map<MessageType, Set<MessageHandler>>();
  private readonly events: MessageEnvelope[] = [];

  async publish(envelope: MessageEnvelope): Promise<void> {
    // Immutable append
    this.events.push(Object.freeze({ ...envelope }));

    const handlers = this.subscribers.get(envelope.messageType);
    if (handlers) {
      for (const handler of handlers) {
        await handler(envelope);
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
    return this.events
      .filter((e) => e.correlationId === correlationId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /** Get all published events (for testing and debugging only) */
  getAllEvents(): readonly MessageEnvelope[] {
    return [...this.events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}
