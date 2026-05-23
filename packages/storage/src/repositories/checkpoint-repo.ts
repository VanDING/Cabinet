import type Database from 'better-sqlite3';

export class CheckpointRepository {
  constructor(private readonly db: Database.Database) {}

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        session_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  save(sessionId: string, state: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO agent_checkpoints (session_id, state, updated_at) VALUES (?, ?, datetime('now'))",
      )
      .run(sessionId, state);
  }

  load(sessionId: string): string | null {
    const row = this.db
      .prepare('SELECT state FROM agent_checkpoints WHERE session_id = ?')
      .get(sessionId) as { state: string } | undefined;
    return row?.state ?? null;
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM agent_checkpoints WHERE session_id = ?').run(sessionId);
  }
}
