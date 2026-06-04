//
// Migration 026 — Autopilot Triggers tables.
//
// Adds:
//   1. autopilot_triggers — cron/webhook/manual trigger configurations
//   2. autopilot_runs      — execution history per trigger
//

import type Database from 'better-sqlite3';

export function runMigration026(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS autopilot_triggers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('cron', 'webhook', 'manual')),
      cron_expression TEXT,
      cron_timezone TEXT DEFAULT 'UTC',
      webhook_token TEXT UNIQUE,
      webhook_secret TEXT,
      webhook_last_called_at TEXT,
      target_agent_id TEXT NOT NULL,
      target_workflow_id TEXT,
      input_template TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      timeout_ms INTEGER NOT NULL DEFAULT 300000,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_autopilot_workspace
      ON autopilot_triggers(workspace_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_autopilot_cron
      ON autopilot_triggers(cron_expression) WHERE trigger_type = 'cron' AND enabled = 1;

    CREATE TABLE IF NOT EXISTS autopilot_runs (
      id TEXT PRIMARY KEY,
      trigger_id TEXT NOT NULL REFERENCES autopilot_triggers(id),
      task_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','completed','failed')),
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      FOREIGN KEY (trigger_id) REFERENCES autopilot_triggers(id)
    );

    CREATE INDEX IF NOT EXISTS idx_autopilot_runs_trigger
      ON autopilot_runs(trigger_id, started_at DESC);
  `);
}
