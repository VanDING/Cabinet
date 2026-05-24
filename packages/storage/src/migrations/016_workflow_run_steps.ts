import type Database from 'better-sqlite3';

export function runMigration016(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_run_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      output TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run ON workflow_run_steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_node ON workflow_run_steps(run_id, node_id);

    CREATE TABLE IF NOT EXISTS workflow_run_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      result_key TEXT NOT NULL,
      result_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_run_results_run ON workflow_run_results(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_run_results_key ON workflow_run_results(run_id, result_key);
  `);
}
