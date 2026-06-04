//
// Migration 027 — Agent Squads (team routing).
//
// Adds:
//   1. agent_squads            — squad definitions with routing strategy
//   2. agent_squad_members     — squad member assignments
//   3. agent_squad_round_robin — round-robin pointer per squad
//

import type Database from 'better-sqlite3';

export function runMigration027(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_squads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'default',
      leader_agent_id TEXT NOT NULL,
      routing_strategy TEXT NOT NULL DEFAULT 'auto'
        CHECK(routing_strategy IN ('auto', 'round_robin', 'leader_decision', 'skill_match')),
      fallback_agent_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_squad_workspace ON agent_squads(workspace_id);

    CREATE TABLE IF NOT EXISTS agent_squad_members (
      id TEXT PRIMARY KEY,
      squad_id TEXT NOT NULL REFERENCES agent_squads(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      member_type TEXT NOT NULL DEFAULT 'ai' CHECK(member_type IN ('ai', 'human')),
      skills_json TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      max_concurrent_tasks INTEGER NOT NULL DEFAULT 3,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (squad_id) REFERENCES agent_squads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_squad_member_agent
      ON agent_squad_members(agent_id, active);

    CREATE TABLE IF NOT EXISTS agent_squad_round_robin (
      squad_id TEXT PRIMARY KEY,
      last_member_index INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (squad_id) REFERENCES agent_squads(id) ON DELETE CASCADE
    );
  `);
}
