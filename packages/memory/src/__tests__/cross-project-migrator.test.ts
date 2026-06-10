import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { LongTermMemory } from '../long-term.js';
import { CrossProjectMigrator } from '../cross-project-migrator.js';
import { unlinkSync } from 'node:fs';

describe('CrossProjectMigrator', () => {
  let db: Database.Database;
  let longTerm: LongTermMemory;
  let migrator: CrossProjectMigrator;
  let indexPath: string;

  beforeEach(() => {
    db = new Database(':memory:');
    indexPath = `/tmp/cabinet-test-crossproj-${Date.now()}.hnsw.index`;
    longTerm = new LongTermMemory(db, 3, indexPath);
    migrator = new CrossProjectMigrator(longTerm);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(indexPath);
    } catch {
      /* ignore */
    }
  });

  it('markAsGlobal updates scope metadata', async () => {
    const id = await longTerm.store({
      content: 'Project-specific note',
      metadata: { projectId: 'proj-a', importance: 0.8 },
      timestamp: new Date(),
    });

    const updated = await migrator.markAsGlobal([id]);
    expect(updated).toBe(1);

    const entry = longTerm.findByIds([id])[0]!;
    expect(entry.metadata.scope).toBe('global');
    expect(entry.metadata.projectId).toBe('proj-a');
  });

  it('markAsWorkspace updates scope metadata', async () => {
    const id = await longTerm.store({
      content: 'Workspace shared note',
      metadata: { projectId: 'proj-b' },
      timestamp: new Date(),
    });

    const updated = await migrator.markAsWorkspace([id]);
    expect(updated).toBe(1);

    const entry = longTerm.findByIds([id])[0]!;
    expect(entry.metadata.scope).toBe('workspace');
  });

  it('migrateToProject copies memories with new projectId', async () => {
    const originalId = await longTerm.store({
      content: 'Reusable pattern about caching',
      metadata: { projectId: 'proj-a', importance: 0.9 },
      timestamp: new Date(),
    });

    const migrated = await migrator.migrateToProject([originalId], 'proj-b');
    expect(migrated).toBe(1);

    // Original should still exist
    const original = longTerm.findByIds([originalId])[0]!;
    expect(original.metadata.projectId).toBe('proj-a');

    // Find the migrated copy
    const all = longTerm.findByMetadataFilter({ projectId: 'proj-b' }, 10);
    expect(all.length).toBe(1);
    expect(all[0]!.content).toBe('Reusable pattern about caching');
    expect(all[0]!.metadata.scope).toBe('project');
    expect(all[0]!.metadata.migratedFrom).toBe('proj-a');
    expect(all[0]!.metadata.migratedAt).toBeTruthy();
  });

  it('findGlobalMemories returns only global-scoped entries', async () => {
    await longTerm.store({
      content: 'Global best practice',
      metadata: { scope: 'global', importance: 0.8 },
      timestamp: new Date(),
    });
    await longTerm.store({
      content: 'Project A specific',
      metadata: { projectId: 'proj-a' },
      timestamp: new Date(),
    });

    const globals = await migrator.findGlobalMemories(undefined, 10);
    expect(globals).toHaveLength(1);
    expect(globals[0]!.content).toBe('Global best practice');
  });

  it('findGlobalMemories filters by query text', async () => {
    await longTerm.store({
      content: 'Global authentication guide',
      metadata: { scope: 'global' },
      timestamp: new Date(),
    });
    await longTerm.store({
      content: 'Global caching strategy',
      metadata: { scope: 'global' },
      timestamp: new Date(),
    });

    const results = await migrator.findGlobalMemories('auth', 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('authentication');
  });

  it('findCrossProjectPatterns detects similar memories across projects', async () => {
    await longTerm.store({
      content: 'Implement caching layer with Redis for high performance API endpoints',
      metadata: { projectId: 'proj-alpha', importance: 0.8 },
      timestamp: new Date(),
    });
    await longTerm.store({
      content: 'Implement caching layer with Redis for high performance web services',
      metadata: { projectId: 'proj-beta', importance: 0.8 },
      timestamp: new Date(),
    });
    await longTerm.store({
      content: 'Completely unrelated content about database schemas',
      metadata: { projectId: 'proj-gamma' },
      timestamp: new Date(),
    });

    const patterns = await migrator.findCrossProjectPatterns(0.3);
    expect(patterns.length).toBeGreaterThan(0);

    const alphaBeta = patterns.find(
      (p) =>
        (p.sourceProjectId === 'proj-alpha' && p.targetProjectId === 'proj-beta') ||
        (p.sourceProjectId === 'proj-beta' && p.targetProjectId === 'proj-alpha'),
    );
    expect(alphaBeta).toBeTruthy();
    expect(alphaBeta!.similarity).toBeGreaterThanOrEqual(0.3);
  });

  it('markAsGlobal returns 0 for non-existent IDs', async () => {
    const updated = await migrator.markAsGlobal(['non-existent-id']);
    expect(updated).toBe(0);
  });
});
