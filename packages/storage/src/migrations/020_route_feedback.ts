import type Database from 'better-sqlite3';

export function runMigration020(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      routed_agent TEXT NOT NULL,
      correct INTEGER NOT NULL DEFAULT 0,
      previous_route TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_route_feedback_route_correct
      ON route_feedback(previous_route, correct);
    CREATE INDEX IF NOT EXISTS idx_route_feedback_timestamp
      ON route_feedback(timestamp);
  `);
}
