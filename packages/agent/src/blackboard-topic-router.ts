import type { EventBus, MessageHandler } from '@cabinet/events';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

/**
 * Routes Blackboard topic messages over the existing EventBus.
 * Uses SystemNotification with a nested topic field to avoid
 * modifying the core EventBus interface.
 */
export class BlackboardTopicRouter {
  private topicHandlers = new Map<string, Set<MessageHandler>>();

  constructor(private readonly eventBus: EventBus) {
    this.eventBus.subscribe(MessageType.SystemNotification, (envelope) => {
      const payload = (envelope.payload as unknown as Record<string, unknown> | undefined)?.data;
      const topic = (payload as Record<string, unknown> | undefined)?.topic as string | undefined;
      if (!topic) return;

      const handlers = this.topicHandlers.get(topic);
      if (handlers) {
        for (const handler of handlers) {
          Promise.resolve(handler(envelope)).catch((err: unknown) =>
            console.error(`Topic handler error for ${topic}:`, err),
          );
        }
      }
    });
  }

  subscribeTopic(topic: string, handler: MessageHandler): () => void {
    let set = this.topicHandlers.get(topic);
    if (!set) {
      set = new Set();
      this.topicHandlers.set(topic, set);
    }
    set.add(handler);

    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.topicHandlers.delete(topic);
    };
  }

  async publishTopic(topic: string, payload: Record<string, unknown>): Promise<void> {
    await this.eventBus.publish({
      messageId: `bb_${topic}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      correlationId: `bb_${topic}`,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: {
        type: 'blackboard_update',
        data: { topic, ...payload },
      } as any,
    });
  }
}
