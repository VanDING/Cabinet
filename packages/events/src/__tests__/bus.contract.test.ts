import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EventBus } from '../bus';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';

/**
 * 契约测试：验证所有 EventBus 实现必须满足的行为。
 * 每个实现（MemoryEventBus, SqliteEventStore）都必须通过这套测试。
 */
export function runEventBusContractTests(
  createBus: () => EventBus,
  cleanup: () => void = () => {},
) {
  describe('EventBus contract', () => {
    let bus: EventBus;

    beforeEach(() => {
      bus = createBus();
    });

    afterEach(() => {
      cleanup();
    });

    it('publishes and receives an event', async () => {
      const received: MessageEnvelope[] = [];
      bus.subscribe(MessageType.SecretaryMessage, (msg) => {
        received.push(msg);
      });

      const envelope: MessageEnvelope = {
        messageId: 'msg-1',
        correlationId: 'corr-1',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SecretaryMessage,
        payload: { text: 'Hello' },
      };

      await bus.publish(envelope);
      expect(received).toHaveLength(1);
      expect(received[0]!.messageId).toBe('msg-1');
    });

    it('multiple subscribers all receive the event', async () => {
      const received1: MessageEnvelope[] = [];
      const received2: MessageEnvelope[] = [];

      bus.subscribe(MessageType.TaskOrder, (msg) => {
        received1.push(msg);
      });
      bus.subscribe(MessageType.TaskOrder, (msg) => {
        received2.push(msg);
      });

      await bus.publish({
        messageId: 'msg-multi',
        correlationId: 'corr-multi',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.TaskOrder,
        payload: { orderId: 'order-1', action: 'execute' },
      });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('subscriber does not receive other message types', async () => {
      const received: MessageEnvelope[] = [];
      bus.subscribe(MessageType.TaskOrder, (msg) => {
        received.push(msg);
      });

      await bus.publish({
        messageId: 'msg-other',
        correlationId: 'corr-other',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SecretaryMessage,
        payload: { text: 'Hi' },
      });

      expect(received).toHaveLength(0);
    });

    it('unsubscribe removes the handler', async () => {
      const received: MessageEnvelope[] = [];
      const handler = (msg: MessageEnvelope) => {
        received.push(msg);
      };

      bus.subscribe(MessageType.TaskOrder, handler);
      bus.unsubscribe(MessageType.TaskOrder, handler);

      await bus.publish({
        messageId: 'msg-unsub',
        correlationId: 'corr-unsub',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.TaskOrder,
        payload: { orderId: 'o', action: 'a' },
      });

      expect(received).toHaveLength(0);
    });

    it('publish returns immediately (async but non-blocking for subscribers)', async () => {
      let called = false;
      bus.subscribe(MessageType.TaskOrder, () => {
        called = true;
      });

      const promise = bus.publish({
        messageId: 'msg-fast',
        correlationId: 'corr-fast',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.TaskOrder,
        payload: { orderId: 'o', action: 'a' },
      });

      expect(promise).toBeInstanceOf(Promise);
      await promise;
      expect(called).toBe(true);
    });
  });
}
