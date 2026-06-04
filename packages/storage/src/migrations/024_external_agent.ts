//
// Migration 024 — External Agent Platform tables and columns.
//
// Adds:
//   1. agent_telemetry  — runtime telemetry from external agents
//   2. context_slot column on sessions-equivalent (via sub_agent_deliverables expansion)
//   3. external_config column on agent_roles
//

import type Database from 'better-sqlite3';

export function runMigration024(db: Database.Database): void {
  // ── agent_telemetry table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      ttft_ms INTEGER NOT NULL DEFAULT 0,
      total_ms INTEGER NOT NULL DEFAULT 0,
      tool_latency_json TEXT NOT NULL DEFAULT '[]',
      steps INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_agent ON agent_telemetry(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_telemetry_task ON agent_telemetry(task_id);
  `);

  // ── agent_roles: external_config column ──
  try {
    db.exec(`ALTER TABLE agent_roles ADD COLUMN external_config TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }

  // ── sub_agent_deliverables: context_slot column ──
  try {
    db.exec(`ALTER TABLE sub_agent_deliverables ADD COLUMN context_slot TEXT`);
  } catch {
    // Column already exists
  }

  // ── employees: source + external_config columns (Phase 2.8 frontend) ──
  try {
    db.exec(`ALTER TABLE employees ADD COLUMN source TEXT NOT NULL DEFAULT 'custom'`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE employees ADD COLUMN external_config TEXT`);
  } catch { /* column exists */ }
}
