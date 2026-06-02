import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CheckpointStore } from '../checkpoint-store.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('CheckpointStore', () => {
  let db: Database.Database;
  let store: CheckpointStore;

  beforeEach(() => {
    db = createDb();
    store = new CheckpointStore(db);
    store.ensureTable();
  });

  it('saves and loads a checkpoint', () => {
    store.save({
      id: 'ckpt_run1_0',
      runId: 'run1',
      parentId: null,
      nodeId: 'buildContext',
      state: JSON.stringify({ messages: [], budget: 0 }),
      pendingTasks: null,
      metadata: JSON.stringify({ source: 'invoke', step: 0 }),
      createdAt: new Date().toISOString(),
    });

    const loaded = store.load('ckpt_run1_0');
    expect(loaded).not.toBeNull();
    expect(loaded!.nodeId).toBe('buildContext');
    expect(JSON.parse(loaded!.state)).toEqual({ messages: [], budget: 0 });
  });

  it('returns null for missing checkpoint', () => {
    expect(store.load('nonexistent')).toBeNull();
  });

  it('forms a linked list via parentId', () => {
    store.save({
      id: 'ckpt_run1_0', runId: 'run1', parentId: null,
      nodeId: 'nodeA', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });
    store.save({
      id: 'ckpt_run1_1', runId: 'run1', parentId: 'ckpt_run1_0',
      nodeId: 'nodeB', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });
    store.save({
      id: 'ckpt_run1_2', runId: 'run1', parentId: 'ckpt_run1_1',
      nodeId: 'nodeC', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });

    expect(store.getPrior('ckpt_run1_2')?.id).toBe('ckpt_run1_1');
    expect(store.getPrior('ckpt_run1_1')?.id).toBe('ckpt_run1_0');
    expect(store.getPrior('ckpt_run1_0')).toBeNull();
  });

  it('lists all checkpoints for a run', () => {
    store.save({
      id: 'ckpt_run1_0', runId: 'run1', parentId: null,
      nodeId: 'nodeA', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });
    store.save({
      id: 'ckpt_run1_1', runId: 'run1', parentId: 'ckpt_run1_0',
      nodeId: 'nodeB', state: '{}', pendingTasks: null,
      metadata: '{}', createdAt: new Date().toISOString(),
    });

    const list = store.listRun('run1');
    expect(list).toHaveLength(2);
  });

  it('gc retains last N checkpoints and deletes older ancestors', () => {
    const ids = ['ckpt_run1_0', 'ckpt_run1_1', 'ckpt_run1_2', 'ckpt_run1_3', 'ckpt_run1_4'];
    let parentId: string | null = null;
    for (const id of ids) {
      store.save({
        id, runId: 'run1', parentId,
        nodeId: 'node', state: '{}', pendingTasks: null,
        metadata: '{}', createdAt: new Date().toISOString(),
      });
      parentId = id;
    }

    store.gc('run1', 3);

    expect(store.load('ckpt_run1_0')).toBeNull();
    expect(store.load('ckpt_run1_1')).toBeNull();
    expect(store.load('ckpt_run1_2')).not.toBeNull();
    expect(store.load('ckpt_run1_3')).not.toBeNull();
    expect(store.load('ckpt_run1_4')).not.toBeNull();
  });
});
