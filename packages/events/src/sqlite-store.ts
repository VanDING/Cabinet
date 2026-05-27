import type { MessageEnvelope, MessageType } from '@cabinet/types';
import type { EventBus, MessageHandler } from './bus';
import type { EventLogRepository } from '@cabinet/storage/repositories/event-log';
import { buildCausationChain } from './causation.js';
import { DeadLetterQueue } from './dead-letter.js';

export class SqliteEventStore implements EventBus {
  private readonly subscribers = new Map<
    MessageType,
    Set<{ handler: MessageHandler; name: string }>
  >();
  readonly deadLetterQueue = new DeadLetterQueue();

  constructor(private readonly eventLog: EventLogRepository) {
    this.deadLetterQueue.setRetryBus(this);
  }

  async publish(envelope: MessageEnvelope): Promise<void> {
    this.eventLog.append(envelope);

    const subs = this.subscribers.get(envelope.messageType);
    if (subs) {
      for (const { handler, name } of subs) {
        try {
          await handler(envelope);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error(`[SqliteEventStore] Handler error (${name}): ${error.message}`);
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
    subs.add({ handler, name: name ?? (handler.name || 'anonymous') });
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
      for (const entry of subs) {
        if (entry.handler === handler) {
          subs.delete(entry);
          break;
        }
      }
    }
  }

  dispose(): void {
    this.subscribers.clear();
  }

  async getCausationChain(correlationId: string): Promise<MessageEnvelope[]> {
    const allEvents = await this.eventLog.findByCorrelationId(correlationId);
    if (allEvents.length === 0) return [];
    const childIds = new Set(allEvents.map((e) => e.causationId).filter(Boolean) as string[]);
    const leaf = allEvents.find((e) => !childIds.has(e.messageId));
    if (!leaf) return allEvents;
    return buildCausationChain(leaf.messageId, allEvents);
  }

  async findAll(opts?: { limit?: number; offset?: number }): Promise<MessageEnvelope[]> {
    return this.eventLog.findAll(opts);
  }

  /**
   * Replay historical events to a handler. Returns the number of events replayed.
   * Useful for new subscribers that need to catch up on past events.
   */
  async replay(since: Date, handler: MessageHandler, messageType?: string): Promise<number> {
    const events = messageType ? this.eventLog.findByType(messageType) : this.eventLog.findAll();
    let count = 0;
    for (const event of events) {
      if (event.timestamp >= since) {
        try {
          await handler(event);
          count++;
        } catch {
          // Skip events that fail during replay
        }
      }
    }
    return count;
  }
}
