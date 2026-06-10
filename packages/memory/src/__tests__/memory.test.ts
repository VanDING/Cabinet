import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { ShortTermMemory } from '../short-term.js';
import { EntityMemory } from '../entity.js';
import { ProjectMemory } from '../project.js';
import { LongTermMemory } from '../long-term.js';
import { ConsolidationService } from '../consolidation.js';
import { MemoryDecayService } from '../memory-decay.js';
import { ProjectIsolatedMemory } from '../project-isolation.js';

const hnswAvailable = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('hnswlib-node');
    return true;
  } catch {
    return false;
  }
})();

// ── ShortTermMemory ───────────────────────────────────────────

describe('ShortTermMemory', () => {
  let mem: ShortTermMemory;
  beforeEach(() => {
    mem = new ShortTermMemory();
  });

  it('stores and retrieves values', () => {
    mem.set('sess-1', 'greeting', 'Hello');
    expect(mem.get('sess-1', 'greeting')).toBe('Hello');
  });

  it('returns null for expired entries', () => {
    mem.set('sess-1', 'temp', 'data', 1); // 1ms TTL
    return new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
      expect(mem.get('sess-1', 'temp')).toBeNull();
    });
  });

  it('returns null for missing key', () => {
    expect(mem.get('sess-x', 'missing')).toBeNull();
  });

  it('clears session data', () => {
    mem.set('sess-1', 'a', 1);
    mem.set('sess-1', 'b', 2);
    mem.clear('sess-1');
    expect(mem.get('sess-1', 'a')).toBeNull();
    expect(mem.get('sess-1', 'b')).toBeNull();
  });

  it('isolates sessions', () => {
    mem.set('sess-1', 'key', 'one');
    mem.set('sess-2', 'key', 'two');
    expect(mem.get('sess-1', 'key')).toBe('one');
    expect(mem.get('sess-2', 'key')).toBe('two');
  });

  it('deletes a single key', () => {
    mem.set('sess-1', 'a', 1);
    mem.set('sess-1', 'b', 2);
    mem.delete('sess-1', 'a');
    expect(mem.get('sess-1', 'a')).toBeNull();
    expect(mem.get('sess-1', 'b')).toBe(2);
  });
});

describe('ShortTermMemory with DB', () => {
  let db: Database.Database;
  let mem: ShortTermMemory;

  beforeEach(() => {
    db = new Database(':memory:');
    mem = new ShortTermMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  it('persists to SQLite and recovers', () => {
    mem.set('sess-db', 'k1', 'v1');
    // Create a fresh instance against the same DB to simulate restart
    const mem2 = new ShortTermMemory(db);
    expect(mem2.get('sess-db', 'k1')).toBe('v1');
  });

  it('delete removes from DB', () => {
    mem.set('sess-db', 'k1', 'v1');
    mem.delete('sess-db', 'k1');
    const mem2 = new ShortTermMemory(db);
    expect(mem2.get('sess-db', 'k1')).toBeNull();
  });

  it('TTL is enforced from DB on recovery', async () => {
    mem.set('sess-db', 'k1', 'v1', 1);
    await new Promise((r) => setTimeout(r, 10));
    const mem2 = new ShortTermMemory(db);
    expect(mem2.get('sess-db', 'k1')).toBeNull();
  });
});

// ── EntityMemory ──────────────────────────────────────────────

describe('EntityMemory', () => {
  let mem: EntityMemory;
  beforeEach(() => {
    mem = new EntityMemory();
  });

  it('stores and retrieves captain preferences', () => {
    mem.setPreferences('c1', 'Captain A', { language: 'zh-CN' });
    const prefs = mem.getPreferences('c1');
    expect(prefs).not.toBeNull();
    expect(prefs!.name).toBe('Captain A');
    expect(prefs!.preferences).toEqual({ language: 'zh-CN' });
  });

  it('returns null for unknown captain', () => {
    expect(mem.getPreferences('unknown')).toBeNull();
  });

  it('stores and lists employees', () => {
    mem.setEmployee({
      employeeId: 'e1',
      name: 'Advisor',
      role: 'finance',
      persona: {},
      pipelineConfig: {},
    });
    expect(mem.listEmployees()).toHaveLength(1);
  });
});

// ── ProjectMemory ─────────────────────────────────────────────

describe('ProjectMemory', () => {
  let mem: ProjectMemory;
  beforeEach(() => {
    mem = new ProjectMemory();
  });

  it('initializes project context', () => {
    const ctx = mem.initialize('p1', ['Launch product']);
    expect(ctx.goals).toHaveLength(1);
    expect(ctx.summary).toContain('1 goals');
  });

  it('tracks milestones and decisions', () => {
    mem.initialize('p1', ['Goal']);
    mem.addMilestone('p1', 'MVP complete');
    mem.addDecision('p1', 'Use TypeScript', 'Approved');
    const ctx = mem.get('p1')!;
    expect(ctx.milestones).toHaveLength(1);
    expect(ctx.keyDecisions).toHaveLength(1);
  });
});

// ── LongTermMemory ────────────────────────────────────────────

describe('LongTermMemory', () => {
  let mem: LongTermMemory;
  let db: Database.Database;
  let indexPath: string;

  beforeEach(() => {
    db = new Database(':memory:');
    indexPath = `/tmp/cabinet-test-${Date.now()}.hnsw.index`;
    mem = new LongTermMemory(db, 3, indexPath);
  });

  afterEach(() => {
    mem.close();
    db.close();
    try {
      unlinkSync(indexPath);
    } catch {
      /* ignore */
    }
  });

  it('stores and searches entries by text', async () => {
    await mem.store({ content: 'The sky is blue', metadata: {}, timestamp: new Date() });
    await mem.store({ content: 'The ocean is deep and blue', metadata: {}, timestamp: new Date() });
    const results = await mem.search('blue');
    expect(results).toHaveLength(2);
  });

  it('returns empty for no matches', async () => {
    const results = await mem.search('nonexistent');
    expect(results).toHaveLength(0);
  });

  it('deletes entries', async () => {
    const id = await mem.store({ content: 'temp', metadata: {}, timestamp: new Date() });
    expect(await mem.delete(id)).toBe(true);
    expect(await mem.delete(id)).toBe(false);
  });

  it('tracks size', async () => {
    expect(mem.size()).toBe(0);
    await mem.store({ content: 'one', metadata: {}, timestamp: new Date() });
    expect(mem.size()).toBe(1);
  });

  (hnswAvailable ? it : it.skip)('searches by embedding similarity via HNSW', async () => {
    await mem.store({
      content: 'Apple makes computers',
      embedding: [1, 0, 0],
      metadata: {},
      timestamp: new Date(),
    });
    await mem.store({
      content: 'Bananas are yellow',
      embedding: [0, 1, 0],
      metadata: {},
      timestamp: new Date(),
    });
    await mem.store({
      content: 'Microsoft makes software',
      embedding: [0.9, 0.1, 0],
      metadata: {},
      timestamp: new Date(),
    });

    const results = await mem.semanticSearch([1, 0, 0], 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toContain('Apple');
  });

  (hnswAvailable ? it : it.skip)('returns empty for no semantic matches', async () => {
    const results = await mem.semanticSearch([1, 1, 1], 5);
    expect(results).toHaveLength(0);
  });

  it('stores and retrieves entries with embeddings', async () => {
    const id = await mem.store({
      content: 'Embedded memory',
      embedding: [0.5, 0.5, 0.5],
      metadata: { tag: 'test' },
      timestamp: new Date(),
    });
    const results = await mem.search('Embedded');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(id);
    expect(results[0]!.embedding).toEqual([0.5, 0.5, 0.5]);
  });

  it('falls back to brute-force cosine search when HNSW is unavailable', async () => {
    await mem.store({
      content: 'Apple makes computers',
      embedding: [1, 0, 0],
      metadata: {},
      timestamp: new Date(),
    });
    await mem.store({
      content: 'Bananas are yellow',
      embedding: [0, 1, 0],
      metadata: {},
      timestamp: new Date(),
    });
    await mem.store({
      content: 'Microsoft makes software',
      embedding: [0.9, 0.1, 0],
      metadata: {},
      timestamp: new Date(),
    });

    // Force HNSW unavailable path
    (mem as any).hnsw = null;

    const results = await mem.semanticSearch([1, 0, 0], 5);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]!.content).toContain('Apple');
    expect(results.some((r) => r.content.includes('Microsoft'))).toBe(true);
  });

  it('brute-force fallback filters expired and archived entries', async () => {
    await mem.store({
      content: 'Active entry about fruit',
      embedding: [1, 0, 0],
      metadata: {},
      timestamp: new Date(),
    });
    await mem.store({
      content: 'Expired entry about fruit',
      embedding: [0.95, 0.05, 0],
      metadata: { status: 'expired' },
      timestamp: new Date(),
    });
    await mem.store({
      content: 'Archived entry about fruit',
      embedding: [0.9, 0.1, 0],
      metadata: { status: 'archived' },
      timestamp: new Date(),
    });

    (mem as any).hnsw = null;

    const results = await mem.semanticSearch([1, 0, 0], 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('Active entry about fruit');
  });

  (hnswAvailable ? it : it.skip)(
    'HNSW semantic search is fast (p95 < 100ms for 1000 entries)',
    async () => {
      const dim = 3;
      for (let i = 0; i < 1000; i++) {
        const vec = [Math.random(), Math.random(), Math.random()];
        await mem.store({
          content: `entry-${i}`,
          embedding: vec,
          metadata: {},
          timestamp: new Date(),
        });
      }
      const times: number[] = [];
      for (let i = 0; i < 20; i++) {
        const q = [Math.random(), Math.random(), Math.random()];
        const start = performance.now();
        await mem.semanticSearch(q, 5);
        times.push(performance.now() - start);
      }
      const p95 = times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1];
      expect(p95).toBeLessThan(100);
    },
  );
});

// ── ProjectIsolatedMemory ─────────────────────────────────────

describe('ProjectIsolatedMemory', () => {
  let db: Database.Database;
  let isolatedA: ProjectIsolatedMemory;
  let isolatedB: ProjectIsolatedMemory;
  let indexPathA: string;
  let indexPathB: string;

  beforeEach(() => {
    db = new Database(':memory:');
    indexPathA = `/tmp/cabinet-test-a-${Date.now()}.hnsw.index`;
    indexPathB = `/tmp/cabinet-test-b-${Date.now()}.hnsw.index`;
    const shortTerm = new ShortTermMemory(db);
    const entity = new EntityMemory(db);
    const project = new ProjectMemory(db);
    isolatedA = new ProjectIsolatedMemory(
      'proj-a',
      shortTerm,
      new LongTermMemory(db, 3, indexPathA),
      entity,
      project,
    );
    isolatedB = new ProjectIsolatedMemory(
      'proj-b',
      shortTerm,
      new LongTermMemory(db, 3, indexPathB),
      entity,
      project,
    );
  });

  afterEach(() => {
    db.close();
    [indexPathA, indexPathB].forEach((p) => {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    });
  });

  it('isolates long-term memories by projectId', async () => {
    await isolatedA.longTermStore('Alpha project spec', {}, [1, 0, 0]);
    await isolatedB.longTermStore('Beta project spec', {}, [0, 1, 0]);

    const resultsA = await isolatedA.longTermSearch('spec', 5);
    const resultsB = await isolatedB.longTermSearch('spec', 5);

    expect(resultsA.every((r) => r.metadata.projectId === 'proj-a')).toBe(true);
    expect(resultsB.every((r) => r.metadata.projectId === 'proj-b')).toBe(true);
    expect(resultsA).toHaveLength(1);
    expect(resultsB).toHaveLength(1);
  });

  it('records access history on search', async () => {
    await isolatedA.longTermStore('Test memory', { importance: 0.8 }, [1, 0, 0]);
    await isolatedA.longTermSearch('test', 5);
    // Wait for async metadata update
    await new Promise((r) => setTimeout(r, 50));

    const rows = (isolatedA as any).longTerm.repo.searchByText('test', 5);
    const meta = JSON.parse(rows[0]!.metadata ?? '{}') as Record<string, unknown>;
    expect(meta.accessCount).toBe(1);
    expect(Array.isArray(meta.accessHistory)).toBe(true);
    expect((meta.accessHistory as Array<unknown>).length).toBe(1);
    expect((meta.accessHistory as Array<{ source: string }>)[0]!.source).toBe('search');
  });
});

// ── ConsolidationService ──────────────────────────────────────

describe('ConsolidationService', () => {
  it('migrates long content to long-term memory and deletes only migrated keys', async () => {
    const short = new ShortTermMemory();
    const long = new LongTermMemory(
      new Database(':memory:'),
      3,
      `/tmp/cabinet-consolidation-${Date.now()}.hnsw.index`,
    );
    const svc = new ConsolidationService(short, long);
    svc.preserveRecentMs = 0; // disable freshness gate for testing

    short.set(
      'sess-1',
      'insight',
      'This is a very important insight that should be stored in long-term memory for future reference.',
    );
    short.set('sess-1', 'brief', 'ok'); // too short, won't migrate
    short.set('sess-1', 'decision_foo', 'small'); // short but decision key, should migrate
    short.set('sess-1', 'fresh', 'This is also important but just written.');

    const count = await svc.consolidateBasic('sess-1');
    // decision_foo (register tier) migrates directly.
    // insight (daily tier) is staged in cascade buffer, not yet sealed.
    expect(count).toBe(1);
    expect(long.size()).toBe(1);

    // Non-migrated keys should still be accessible
    expect(short.get('sess-1', 'brief')).toBe('ok');
    expect(short.get('sess-1', 'fresh')).toBe('This is also important but just written.');
    // insight is still in short-term (buffered, not sealed)
    expect(short.get('sess-1', 'insight')).not.toBeNull();
    // decision_foo is gone (directly migrated)
    expect(short.get('sess-1', 'decision_foo')).toBeNull();

    // Flush cascade buffer to force-seal daily-tier entries
    const flushed = await svc.flushSession('sess-1');
    expect(flushed).toBe(1);
    expect(long.size()).toBe(2);
    // Now insight is also gone from short-term
    expect(short.get('sess-1', 'insight')).toBeNull();

    long.close();
  });
});

// ── MemoryDecayService (Ebbinghaus adaptive) ──────────────────

describe('MemoryDecayService', () => {
  it('computeAdaptiveHalfLife returns 30 for empty history', () => {
    const halfLife = MemoryDecayService.computeAdaptiveHalfLife({});
    expect(halfLife).toBe(30);
  });

  it('extends half-life for frequently accessed memories', () => {
    const history = [
      { at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), source: 'search' },
      { at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), source: 'search' },
      { at: new Date().toISOString(), source: 'search' },
    ];
    // avg interval = 3.5 days → half-life = 900/3.5 ≈ 257 → clamped to 90
    const halfLife = MemoryDecayService.computeAdaptiveHalfLife({ accessHistory: history });
    expect(halfLife).toBe(90);
  });

  it('score is higher for frequently accessed memories of same age', () => {
    const timestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const baseScore = MemoryDecayService.score({
      timestamp,
      metadata: { importance: 0.5, confidence: 0.5 },
    });
    const accessedScore = MemoryDecayService.score({
      timestamp,
      metadata: { importance: 0.5, confidence: 0.5, accessCount: 5, accessHistory: [
        { at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), source: 'search' },
        { at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(), source: 'search' },
        { at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), source: 'search' },
        { at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), source: 'search' },
        { at: new Date().toISOString(), source: 'search' },
      ]},
    });
    expect(accessedScore).toBeGreaterThan(baseScore);
  });

  it('caps half-life at 90 days and floor at 7 days', () => {
    const veryFrequent = Array.from({ length: 50 }, (_, i) => ({
      at: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
      source: 'search',
    })).reverse();
    const halfLife = MemoryDecayService.computeAdaptiveHalfLife({ accessHistory: veryFrequent });
    expect(halfLife).toBe(90);

    const veryRare = [
      { at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), source: 'search' },
      { at: new Date().toISOString(), source: 'search' },
    ];
    const halfLifeRare = MemoryDecayService.computeAdaptiveHalfLife({ accessHistory: veryRare });
    expect(halfLifeRare).toBe(7); // 900/365 = 2.46 → clamped to 7
  });
});
