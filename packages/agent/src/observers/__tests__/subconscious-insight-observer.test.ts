import { describe, it, expect, vi } from 'vitest';
import { SubconsciousInsightObserver, type SubconsciousInsight } from '../subconscious-insight.js';
import { MessageType } from '@cabinet/types';
import type { EventBus } from '@cabinet/events';

function makeBus(): EventBus {
  const subs = new Map<MessageType, Array<(msg: any) => void>>();
  return {
    subscribe: vi.fn((type, handler) => {
      const list = subs.get(type) ?? [];
      list.push(handler);
      subs.set(type, list);
    }),
    unsubscribe: vi.fn((type, handler) => {
      const list = subs.get(type) ?? [];
      subs.set(
        type,
        list.filter((h) => h !== handler),
      );
    }),
    publish: vi.fn(async (envelope: any) => {
      const list = subs.get(envelope.messageType) ?? [];
      for (const h of list) h(envelope);
    }),
  } as unknown as EventBus;
}

function makeInsight(text: string): SubconsciousInsight {
  return {
    relevance: 0.8,
    text,
    sourceMemoryId: 'm1',
    relatedEntities: ['e1'],
  };
}

describe('SubconsciousInsightObserver', () => {
  it('collects subconscious_insight events and attaches them to context', async () => {
    const bus = makeBus();
    const observer = new SubconsciousInsightObserver(bus, 2);

    await bus.publish({
      messageId: 'sub-1',
      correlationId: 'c1',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: { type: 'subconscious_insight', insight: makeInsight('remember X') },
    });

    expect(observer.pendingCount()).toBe(1);

    const ctx = { messages: [] } as any;
    await observer.onStreamStart(ctx);

    expect(observer.pendingCount()).toBe(0);
    expect(ctx.pendingSubconsciousInsights).toHaveLength(1);
    expect(ctx.pendingSubconsciousInsights[0].text).toBe('remember X');

    observer.dispose();
  });

  it('ignores unrelated system notifications', async () => {
    const bus = makeBus();
    const observer = new SubconsciousInsightObserver(bus);

    await bus.publish({
      messageId: 'other',
      correlationId: 'c1',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: { type: 'tool_notification', message: 'hello' },
    });

    expect(observer.pendingCount()).toBe(0);
    observer.dispose();
  });

  it('caps queue at maxInsights', async () => {
    const bus = makeBus();
    const observer = new SubconsciousInsightObserver(bus, 2);

    for (let i = 0; i < 5; i++) {
      await bus.publish({
        messageId: `sub-${i}`,
        correlationId: 'c1',
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SystemNotification,
        payload: { type: 'subconscious_insight', insight: makeInsight(`insight ${i}`) },
      });
    }

    expect(observer.pendingCount()).toBe(2);
    observer.dispose();
  });
});
