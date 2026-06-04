//
// Migration 025 — Agent Daemon + Task Queue tables.
//
// Adds:
//   1. agent_task_queue      — pull-mode task dispatch with full lifecycle
//   2. agent_daemon_heartbeats — daemon liveness tracking
//   3. agent_workspaces      — workspace directory lifecycle for GC
//   4. daemon_config column on agent_roles
//

import type Database from 'better-sqlite3';

export function runMigration025(db: Database.Database): void {
  // ── agent_task_queue ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_task_queue (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      capability TEXT NOT NULL DEFAULT 'default',
      input TEXT NOT NULL DEFAULT '',
      slot_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','claimed','running','completed','failed','cancelled')),
      priority INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      timeout_ms INTEGER NOT NULL DEFAULT 120000,
      claimed_by TEXT,
      claimed_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      progress_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      output_json TEXT,
      cron_expression TEXT,
      webhook_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_task_queue_status
      ON agent_task_queue(status, priority DESC);
    CREATE INDEX IF NOT EXISTS idx_task_queue_agent
      ON agent_task_queue(agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_task_queue_claimed
      ON agent_task_queue(claimed_by, status);
    CREATE INDEX IF NOT EXISTS idx_task_queue_session
      ON agent_task_queue(session_id);
  `);

  // ── agent_daemon_heartbeats ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_daemon_heartbeats (
      daemon_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'online'
        CHECK(status IN ('online','degraded','offline')),
      last_heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      version TEXT NOT NULL DEFAULT '1.0.0',
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_heartbeat_agent
      ON agent_daemon_heartbeats(agent_id);
  `);

  // ── agent_workspaces ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_workspaces (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','archived','cleaned')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_agent
      ON agent_workspaces(agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_workspace_expires
      ON agent_workspaces(expires_at) WHERE expires_at IS NOT NULL;
  `);

  // ── agent_roles: daemon_config column ──
  try {
    db.exec(`ALTER TABLE agent_roles ADD COLUMN daemon_config TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }
}
