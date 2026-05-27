import { describe, it, expect, beforeEach } from 'vitest';
import { createConnection } from '../connection.js';
import { SystemKnowledgeRepository } from '../repositories/system-knowledge-repo.js';
import { syncSystemKnowledge, SYSTEM_KNOWLEDGE_BASE } from '../system-knowledge-base.js';
import type { Database } from 'better-sqlite3';

describe('SystemKnowledgeRepository', () => {
  let db: Database;
  let repo: SystemKnowledgeRepository;

  beforeEach(() => {
    db = createConnection(':memory:');
    repo = new SystemKnowledgeRepository(db);
    repo.ensureTable();
    // Clean up any default entries from syncSystemKnowledge calls in other tests
    db.exec('DELETE FROM system_knowledge');
  });

  it('ensureTable creates correct schema', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='system_knowledge'")
      .get() as { name: string } | undefined;
    expect(tables?.name).toBe('system_knowledge');

    const indices = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='system_knowledge'")
      .all() as { name: string }[];
    const indexNames = indices.map((i) => i.name);
    expect(indexNames).toContain('idx_sk_topic');
    expect(indexNames).toContain('idx_sk_category');
  });

  it('upsert inserts and updates', () => {
    repo.upsert({
      id: 'test_entry',
      topic: 'Test Topic',
      category: 'capability',
      content: 'Initial content',
      version: 1,
      metadata: '{}',
    });

    const found = repo.findByTopic('Test Topic');
    expect(found).toBeDefined();
    expect(found!.content).toBe('Initial content');
    expect(found!.version).toBe(1);

    repo.upsert({
      id: 'test_entry',
      topic: 'Test Topic',
      category: 'capability',
      content: 'Updated content',
      version: 2,
      metadata: '{}',
    });

    const updated = repo.findByTopic('Test Topic');
    expect(updated!.content).toBe('Updated content');
    expect(updated!.version).toBe(2);
  });

  it('findByTopic returns exact match', () => {
    repo.upsert({
      id: 'topic_a',
      topic: 'Directory Structure',
      category: 'infrastructure',
      content: '...',
      version: 1,
      metadata: '{}',
    });

    expect(repo.findByTopic('Directory Structure')).toBeDefined();
    expect(repo.findByTopic('Nonexistent')).toBeUndefined();
  });

  it('search uses LIKE for full-text search', () => {
    repo.upsert({
      id: 'search_test',
      topic: 'Scheduler Capabilities',
      category: 'capability',
      content: 'Cron expressions and task scheduling',
      version: 1,
      metadata: '{}',
    });

    const results = repo.search('cron', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.topic).toBe('Scheduler Capabilities');

    const topicResults = repo.search('Scheduler', 5);
    expect(topicResults.length).toBeGreaterThan(0);
  });

  it('findByCategory filters correctly', () => {
    repo.upsert({
      id: 'a',
      topic: 'A',
      category: 'capability',
      content: '...',
      version: 1,
      metadata: '{}',
    });
    repo.upsert({
      id: 'b',
      topic: 'B',
      category: 'infrastructure',
      content: '...',
      version: 1,
      metadata: '{}',
    });
    repo.upsert({
      id: 'c',
      topic: 'C',
      category: 'capability',
      content: '...',
      version: 1,
      metadata: '{}',
    });

    const caps = repo.findByCategory('capability');
    expect(caps).toHaveLength(2);
    expect(caps.map((e) => e.topic)).toContain('A');
    expect(caps.map((e) => e.topic)).toContain('C');
  });

  it('syncSystemKnowledge handles version comparison', () => {
    const result = syncSystemKnowledge(db, SYSTEM_KNOWLEDGE_BASE);
    expect(result.created).toBe(SYSTEM_KNOWLEDGE_BASE.length);
    expect(result.updated).toBe(0);

    // Same version — no changes
    const result2 = syncSystemKnowledge(db, SYSTEM_KNOWLEDGE_BASE);
    expect(result2.created).toBe(0);
    expect(result2.updated).toBe(0);

    // Bump version — should update
    const bumped = SYSTEM_KNOWLEDGE_BASE.map((e) => ({ ...e, version: e.version + 1 }));
    const result3 = syncSystemKnowledge(db, bumped);
    expect(result3.created).toBe(0);
    expect(result3.updated).toBe(SYSTEM_KNOWLEDGE_BASE.length);
  });
});
