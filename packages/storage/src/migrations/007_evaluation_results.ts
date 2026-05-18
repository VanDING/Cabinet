import type Database from 'better-sqlite3';

export function runMigration007(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS evaluation_results (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'agent_output',
      source_id TEXT,
      overall_score REAL NOT NULL DEFAULT 0,
      dimensions TEXT NOT NULL DEFAULT '{}',
      feedback TEXT,
      evaluator_model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_eval_results_project ON evaluation_results(project_id);
    CREATE INDEX IF NOT EXISTS idx_eval_results_source ON evaluation_results(source_type, source_id);
  `);
}
