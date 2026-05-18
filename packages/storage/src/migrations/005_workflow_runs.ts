import type Database from 'better-sqlite3';

export function runMigration005(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      current_node_id TEXT,
      steps TEXT NOT NULL DEFAULT '[]',
      results TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);

    CREATE TABLE IF NOT EXISTS session_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project_id TEXT,
      role TEXT,
      model TEXT,
      total_steps INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      total_cost REAL DEFAULT 0,
      tool_calls_total INTEGER DEFAULT 0,
      tool_calls_failed INTEGER DEFAULT 0,
      tool_calls_blocked INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      success INTEGER DEFAULT 0,
      error_type TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_session_metrics_session ON session_metrics(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_metrics_time ON session_metrics(started_at);
  `);
}
