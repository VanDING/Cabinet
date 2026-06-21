import type Database from 'better-sqlite3';

export function runMigration031(db: Database.Database): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_mcp_bindings (
      id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,
      mcp_server_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(agent_type, mcp_server_name)
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_agent_mcp_bindings_agent
    ON agent_mcp_bindings(agent_type)
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS agent_skill_bindings (
      id TEXT PRIMARY KEY,
      agent_type TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(agent_type, skill_name)
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_agent_skill_bindings_agent
    ON agent_skill_bindings(agent_type)
  `).run();
}
