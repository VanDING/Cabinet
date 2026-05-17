import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ShortTermMemory } from '../short-term.js';
import { EntityMemory } from '../entity.js';
import { ProjectMemory } from '../project.js';
import { LongTermMemory } from '../long-term.js';
import { ConsolidationService } from '../consolidation.js';

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
    // Wait a tick
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
});

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

describe('LongTermMemory', () => {
  let mem: LongTermMemory;
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(':memory:');
    mem = new LongTermMemory(db);
  });
  afterEach(() => {
    mem.close();
    db.close();
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

  it('searches by embedding similarity', async () => {
    await mem.store({
      content: 'Apple makes great computers',
      embedding: [1, 0, 0],
      metadata: {},
      timestamp: new Date(),
    });
    await mem.store({
      content: 'Bananas are yellow fruits',
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

  it('returns empty for no semantic matches', async () => {
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
});

describe('ConsolidationService', () => {
  it('migrates long content to long-term memory', async () => {
    const short = new ShortTermMemory();
    const long = new LongTermMemory(new Database(':memory:'));
    const svc = new ConsolidationService(short, long);

    short.set(
      'sess-1',
      'insight',
      'This is a very important insight that should be stored in long-term memory for future reference.',
    );
    short.set('sess-1', 'brief', 'ok'); // too short, won't migrate

    const count = await svc.consolidateBasic('sess-1');
    expect(count).toBe(1);
    expect(long.size()).toBe(1);

    // Short-term should be cleared
    expect(short.get('sess-1', 'insight')).toBeNull();
    expect(short.get('sess-1', 'brief')).toBeNull();
  });
});
