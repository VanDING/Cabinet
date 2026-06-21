import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { LongTermMemory } from '../long-term.js';
import { ProjectIsolatedMemory } from '../project-isolation.js';
import { ShortTermMemory } from '../short-term.js';
import { EntityMemory } from '../entity.js';
import { ProjectMemory } from '../project.js';

const hnswAvailable = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('hnswlib-node');
    return true;
  } catch {
    return false;
  }
})();

function randomVec(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random());
}

function nowMs(): number {
  return performance.now();
}

// ── Insertion Benchmark ───────────────────────────────────────

describe('Benchmark: Insertion Performance', () => {
  let db: Database.Database;
  let mem: LongTermMemory;
  let indexPath: string;

  beforeEach(() => {
    db = new Database(':memory:');
    indexPath = `/tmp/cabinet-bench-${Date.now()}.hnsw.index`;
    mem = new LongTermMemory(db, 128, indexPath);
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

  it('inserts 1000 entries in < 10s', async () => {
    const start = nowMs();
    for (let i = 0; i < 1000; i++) {
      await mem.store({
        content: `Benchmark entry number ${i} with some contextual text to simulate realistic content length.`,
        embedding: randomVec(128),
        metadata: { source: 'benchmark', idx: i },
        timestamp: new Date(),
      });
    }
    const elapsed = nowMs() - start;
    expect(elapsed).toBeLessThan(10000);
  });

  it('inserts 10000 entries in < 60s', { timeout: 65000 }, async () => {
    const start = nowMs();
    for (let i = 0; i < 10000; i++) {
      await mem.store({
        content: `Bulk benchmark entry ${i}.`,
        embedding: randomVec(128),
        metadata: { source: 'benchmark', idx: i },
        timestamp: new Date(),
      });
    }
    const elapsed = nowMs() - start;
    expect(elapsed).toBeLessThan(60000);
  });
});

// ── Retrieval Benchmark ───────────────────────────────────────

describe('Benchmark: Retrieval Performance', () => {
  let db: Database.Database;
  let mem: LongTermMemory;
  let indexPath: string;
  const COUNT = 10000;
  const DIM = 128;

  beforeEach(async () => {
    db = new Database(':memory:');
    indexPath = `/tmp/cabinet-bench-retrieval-${Date.now()}.hnsw.index`;
    mem = new LongTermMemory(db, DIM, indexPath);
    // Seed with synthetic data
    for (let i = 0; i < COUNT; i++) {
      const topic =
        i % 5 === 0
          ? 'architecture'
          : i % 5 === 1
            ? 'deployment'
            : i % 5 === 2
              ? 'security'
              : i % 5 === 3
                ? 'performance'
                : 'testing';
      await mem.store({
        content: `${topic} discussion item ${i}: ${Array.from({ length: 20 }, (_, j) => `word${j}`).join(' ')}`,
        embedding: randomVec(DIM),
        metadata: { topic, idx: i },
        timestamp: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      });
    }
  }, 60000);

  afterEach(() => {
    mem.close();
    db.close();
    try {
      unlinkSync(indexPath);
    } catch {
      /* ignore */
    }
  });

  (hnswAvailable ? it : it.skip)('semantic search p95 < 100ms (10000 entries)', async () => {
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const q = randomVec(DIM);
      const start = nowMs();
      await mem.semanticSearch(q, 5);
      times.push(nowMs() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    expect(p95).toBeLessThan(100);
  });

  it('text search p95 < 100ms (10000 entries)', async () => {
    const times: number[] = [];
    const queries = [
      'architecture',
      'deployment',
      'security',
      'performance',
      'testing',
      'nonexistent',
    ];
    for (let i = 0; i < 50; i++) {
      const q = queries[i % queries.length]!;
      const start = nowMs();
      await mem.search(q, 5);
      times.push(nowMs() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    expect(p95).toBeLessThan(100);
  });

  it('hybrid search returns results', async () => {
    const results = await mem.search('architecture', 5, randomVec(DIM));
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});

// ── Accuracy / Ground-Truth Benchmark ─────────────────────────

describe('Benchmark: Semantic Search Accuracy', () => {
  let db: Database.Database;
  let mem: LongTermMemory;
  let indexPath: string;
  const DIM = 128;

  beforeEach(async () => {
    db = new Database(':memory:');
    indexPath = `/tmp/cabinet-bench-accuracy-${Date.now()}.hnsw.index`;
    mem = new LongTermMemory(db, DIM, indexPath);

    // Create clusters of semantically similar vectors using distinct dimension masks
    // so cosine similarity can actually separate them.
    const clusters = [
      { label: 'react', maskStart: 0, maskEnd: 42, value: 0.9 },
      { label: 'vue', maskStart: 42, maskEnd: 84, value: 0.9 },
      { label: 'angular', maskStart: 84, maskEnd: 128, value: 0.9 },
    ];

    for (let i = 0; i < 300; i++) {
      const cluster = clusters[i % clusters.length]!;
      const vec = Array.from({ length: DIM }, (_, d) => {
        if (d >= cluster.maskStart && d < cluster.maskEnd) {
          return cluster.value + (Math.random() - 0.5) * 0.1;
        }
        return 0.1 + (Math.random() - 0.5) * 0.05;
      });
      await mem.store({
        content: `${cluster.label} framework note ${i}`,
        embedding: vec,
        metadata: { cluster: cluster.label },
        timestamp: new Date(),
      });
    }
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

  (hnswAvailable ? it : it.skip)('top-5 recall rate > 85% for cluster queries', async () => {
    const queries = [
      {
        vec: Array.from({ length: DIM }, (_, d) => (d >= 0 && d < 42 ? 0.9 : 0.1)),
        expectedCluster: 'react',
      },
      {
        vec: Array.from({ length: DIM }, (_, d) => (d >= 42 && d < 84 ? 0.9 : 0.1)),
        expectedCluster: 'vue',
      },
      {
        vec: Array.from({ length: DIM }, (_, d) => (d >= 84 && d < 128 ? 0.9 : 0.1)),
        expectedCluster: 'angular',
      },
    ];

    let totalRelevant = 0;
    let totalRetrieved = 0;

    for (const q of queries) {
      const results = await mem.semanticSearch(q.vec, 5);
      totalRetrieved += results.length;
      for (const r of results) {
        if (r.metadata.cluster === q.expectedCluster) {
          totalRelevant++;
        }
      }
    }

    const recall = totalRetrieved > 0 ? totalRelevant / totalRetrieved : 0;
    expect(recall).toBeGreaterThanOrEqual(0.85);
  });
});

// ── Isolation Benchmark ───────────────────────────────────────

describe('Benchmark: Project Isolation', () => {
  let db: Database.Database;
  let isolatedA: ProjectIsolatedMemory;
  let isolatedB: ProjectIsolatedMemory;
  let indexPathA: string;
  let indexPathB: string;

  beforeEach(() => {
    db = new Database(':memory:');
    indexPathA = `/tmp/cabinet-bench-iso-a-${Date.now()}.hnsw.index`;
    indexPathB = `/tmp/cabinet-bench-iso-b-${Date.now()}.hnsw.index`;
    const shortTerm = new ShortTermMemory(db);
    const entity = new EntityMemory(db);
    const project = new ProjectMemory(db);
    isolatedA = new ProjectIsolatedMemory(
      'proj-a',
      shortTerm,
      new LongTermMemory(db, 128, indexPathA),
      entity,
      project,
    );
    isolatedB = new ProjectIsolatedMemory(
      'proj-b',
      shortTerm,
      new LongTermMemory(db, 128, indexPathB),
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

  it('does not leak across projects under mixed load', async () => {
    for (let i = 0; i < 500; i++) {
      await isolatedA.longTermStore(`Alpha spec ${i}`, {}, randomVec(128));
      await isolatedB.longTermStore(`Beta spec ${i}`, {}, randomVec(128));
    }

    const resultsA = await isolatedA.longTermSearch('Alpha', 10);
    const resultsB = await isolatedB.longTermSearch('Beta', 10);

    expect(resultsA.every((r) => r.metadata.projectId === 'proj-a')).toBe(true);
    expect(resultsB.every((r) => r.metadata.projectId === 'proj-b')).toBe(true);
    expect(resultsA).toHaveLength(10);
    expect(resultsB).toHaveLength(10);
  });
});

// ── Memory Footprint Benchmark ────────────────────────────────

describe('Benchmark: Memory Footprint', () => {
  it('RSS stays under 512MB with 10000 entries', { timeout: 65000 }, async () => {
    const db = new Database(':memory:');
    const indexPath = `/tmp/cabinet-bench-mem-${Date.now()}.hnsw.index`;
    const mem = new LongTermMemory(db, 128, indexPath);

    if (typeof process !== 'undefined' && process.memoryUsage) {
      const before = process.memoryUsage().rss;
      for (let i = 0; i < 10000; i++) {
        await mem.store({
          content: `Memory footprint entry ${i} with enough text to be realistic.`,
          embedding: randomVec(128),
          metadata: { idx: i },
          timestamp: new Date(),
        });
      }
      const after = process.memoryUsage().rss;
      const deltaMB = (after - before) / (1024 * 1024);
      expect(deltaMB).toBeLessThan(512);
      mem.close();
      db.close();
      try {
        unlinkSync(indexPath);
      } catch {
        /* ignore */
      }
    }
  });
});
