import type Database from 'better-sqlite3';

/**
 * Migration 022: Sub-agent interaction support.
 * Adds tables for agent execution events and deliverables,
 * and extends the sessions concept with parent/child relationships.
 */
export function runMigration022(db: Database.Database): void {
  db.exec(`
    -- Agent execution events (append-only log per sub-agent session)
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(created_at);

    -- Sub-agent deliverables (final structured output)
    CREATE TABLE IF NOT EXISTS sub_agent_deliverables (
      session_id TEXT PRIMARY KEY,
      deliverable_type TEXT,
      deliverable_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
