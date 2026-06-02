import type Database from 'better-sqlite3';

export interface CheckpointRecord {
  id: string;
  runId: string;
  parentId: string | null;
  nodeId: string;
  state: string;
  pendingTasks: string | null;
  metadata: string;
  createdAt: string;
}

export class CheckpointStore {
  constructor(private readonly db: Database.Database) {}

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        parent_id TEXT,
        node_id TEXT NOT NULL,
        state TEXT NOT NULL,
        pending_tasks TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_graph_checkpoints_run
      ON graph_checkpoints(run_id, created_at)
    `);
  }

  save(record: CheckpointRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO graph_checkpoints
         (id, run_id, parent_id, node_id, state, pending_tasks, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id, record.runId, record.parentId, record.nodeId,
        record.state, record.pendingTasks, record.metadata, record.createdAt,
      );
  }

  load(id: string): CheckpointRecord | null {
    const row = this.db
      .prepare('SELECT * FROM graph_checkpoints WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  getPrior(id: string): CheckpointRecord | null {
    const current = this.load(id);
    if (!current?.parentId) return null;
    return this.load(current.parentId);
  }

  listRun(runId: string): CheckpointRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM graph_checkpoints WHERE run_id = ? ORDER BY created_at ASC',
      )
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRecord(r));
  }

  gc(runId: string, keepLast: number): void {
    const rows = this.db
      .prepare(
        'SELECT id FROM graph_checkpoints WHERE run_id = ? ORDER BY created_at DESC',
      )
      .all(runId) as { id: string }[];

    if (rows.length <= keepLast) return;

    const toDelete = rows.slice(keepLast).map((r) => r.id);
    const placeholders = toDelete.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM graph_checkpoints WHERE id IN (${placeholders})`)
      .run(...toDelete);
  }

  private rowToRecord(row: Record<string, unknown>): CheckpointRecord {
    return {
      id: row['id'] as string,
      runId: row['run_id'] as string,
      parentId: (row['parent_id'] as string) ?? null,
      nodeId: row['node_id'] as string,
      state: row['state'] as string,
      pendingTasks: (row['pending_tasks'] as string) ?? null,
      metadata: (row['metadata'] as string) ?? '{}',
      createdAt: row['created_at'] as string,
    };
  }
}
