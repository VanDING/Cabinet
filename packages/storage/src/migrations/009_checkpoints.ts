import type Database from 'better-sqlite3';

export function runMigration009(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_checkpoints (
      session_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
