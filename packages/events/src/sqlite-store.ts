import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';
import type { EventLogRepository } from '@cabinet/storage/repositories/event-log';
import { buildCausationChain } from './causation.js';

export class SqliteEventStore implements EventBus {
  private readonly subscribers = new Map<MessageType, Set<MessageHandler>>();

  constructor(private readonly eventLog: EventLogRepository) {}

  async publish(envelope: MessageEnvelope): Promise<void> {
    this.eventLog.append(envelope);

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
    const allEvents = await this.eventLog.findByCorrelationId(correlationId);
    if (allEvents.length === 0) return [];
    const childIds = new Set(allEvents.map((e) => e.causationId).filter(Boolean) as string[]);
    const leaf = allEvents.find((e) => !childIds.has(e.messageId));
    if (!leaf) return allEvents;
    return buildCausationChain(leaf.messageId, allEvents);
  }

  async findAll(): Promise<MessageEnvelope[]> {
    return this.eventLog.findAll();
  }
}
