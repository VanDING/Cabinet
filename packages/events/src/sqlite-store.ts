import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';
import { EventLogRepository } from '@cabinet/storage/repositories/event-log';
import type Database from 'better-sqlite3';

export class SqliteEventStore implements EventBus {
  private readonly eventLog: EventLogRepository;
  private readonly subscribers = new Map<MessageType, Set<MessageHandler>>();

  constructor(db: Database.Database) {
    this.eventLog = new EventLogRepository(db);
  }

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
