import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';
import type { EventLogRepository } from '@cabinet/storage/repositories/event-log';

export class SqliteEventStore implements EventBus {
  private readonly subscribers = new Map<MessageType, Set<MessageHandler>>();

  constructor(private readonly eventLog: EventLogRepository) {}

  async publish(envelope: MessageEnvelope): Promise<void> {
    this.eventLog.append(envelope);

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
    return this.eventLog.findByCorrelationId(correlationId);
  }

  async findAll(): Promise<MessageEnvelope[]> {
    return this.eventLog.findAll();
  }
}
