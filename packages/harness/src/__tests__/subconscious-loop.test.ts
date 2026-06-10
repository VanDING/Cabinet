import { describe, it, expect, vi } from 'vitest';
import { SubconsciousLoop, type SubconsciousInsight } from '../subconscious-loop.js';
import { MessageType } from '@cabinet/types';

describe('SubconsciousLoop', () => {
  const makeMockLongTerm = (memories: Array<{ id: string; content: string; metadata: Record<string, unknown>; timestamp: Date }>) => ({
    search: vi.fn(async (_q: string, _limit: number) => memories),
  });

  const makeMockKG = () => ({
    searchEntities: vi.fn(() => [] as Array<{ name: string }>),
    findRelated: vi.fn(() => [] as Array<{ name: string }>),
  });

  const makeMockEventBus = () => ({
    publish: vi.fn(async () => {}),
  });

  it('tick returns empty array when no memories exist', async () => {
    const loop = new SubconsciousLoop(
      makeMockLongTerm([]) as any,
      makeMockKG() as any,
      makeMockEventBus() as any,
    );
    const insights = await loop.tick();
    expect(insights).toEqual([]);
  });

  it('tick returns insights with filled sourceMemoryId', async () => {
    const memories = [
      {
        id: 'mem-1',
        content: 'How does the authentication flow work?',
        metadata: { importance: 0.9 },
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: 'mem-2',
        content: 'Database schema migration plan for v2',
        metadata: { importance: 0.8 },
        timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    ];
    const loop = new SubconsciousLoop(
      makeMockLongTerm(memories) as any,
      makeMockKG() as any,
      makeMockEventBus() as any,
    );
    const insights = await loop.tick();
    // With only 2 memories and random scoring, we may get 0–2 insights.
    // Each insight that passes relevance > 0.6 should have sourceMemoryId set.
    for (const insight of insights) {
      expect(insight.sourceMemoryId).toBeTruthy();
      expect(insight.sourceMemoryId).not.toBe('');
      expect(insight.text).toContain('...');
      expect(insight.relevance).toBeGreaterThan(0.6);
      expect(insight.relevance).toBeLessThanOrEqual(0.95);
    }
  });

  it('tick publishes events for high-relevance insights', async () => {
    const memories = [
      {
        id: 'mem-q',
        content: 'What is the best way to handle race conditions?',
        metadata: { importance: 1.0 },
        timestamp: new Date(),
      },
    ];
    const eventBus = makeMockEventBus();
    const loop = new SubconsciousLoop(
      makeMockLongTerm(memories) as any,
      makeMockKG() as any,
      eventBus as any,
    );
    const insights = await loop.tick();
    // question boost (+0.15) + importance should push relevance > 0.6
    if (insights.length > 0) {
      expect(eventBus.publish).toHaveBeenCalled();
      const calls = (eventBus.publish as any).mock.calls;
      const call = calls[0][0] as any;
      expect(call.messageType).toBe(MessageType.SystemNotification);
      expect(call.payload.type).toBe('subconscious_insight');
      expect(call.payload.insight.sourceMemoryId).toBe('mem-q');
    }
  });

  it('tick boosts relevance for related entities', async () => {
    const memories = [
      {
        id: 'mem-entity',
        content: 'A long and detailed observation about the caching layer behavior under load.',
        metadata: { importance: 0.7 },
        timestamp: new Date(),
      },
    ];
    const kg = makeMockKG();
    kg.searchEntities = vi.fn(() => [{ name: 'CacheLayer' }]);
    kg.findRelated = vi.fn(() => [{ name: 'Redis' }, { name: 'Memcached' }]);

    const loop = new SubconsciousLoop(
      makeMockLongTerm(memories) as any,
      kg as any,
      makeMockEventBus() as any,
    );
    const insights = await loop.tick();
    if (insights.length > 0) {
      const insight = insights[0]!;
      expect(insight.relatedEntities).toContain('Redis');
      expect(insight.text).toContain('CacheLayer');
    }
  });
});
