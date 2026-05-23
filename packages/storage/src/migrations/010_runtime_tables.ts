import type Database from 'better-sqlite3';

/**
 * Migration 010: Tables previously created at runtime via ensureTable().
 * These are now formalized as proper migrations.
 */
export function runMigration010(db: Database.Database): void {
  db.exec(`
    -- Short-term memory (session-scoped key-value store)
    CREATE TABLE IF NOT EXISTS short_term (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      ttl INTEGER NOT NULL DEFAULT 1800000,
      PRIMARY KEY (session_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_short_term_session ON short_term(session_id);

    -- Long-term memory with optional embedding vectors
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON memory_embeddings(timestamp);

    -- Entity preferences (per-captain settings)
    CREATE TABLE IF NOT EXISTS entity_prefs (
      captain_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      preferences TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Entity employee configurations
    CREATE TABLE IF NOT EXISTS entity_employees (
      employee_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      persona TEXT NOT NULL DEFAULT '{}',
      pipeline_config TEXT NOT NULL DEFAULT '{}'
    );

    -- Cost tracking history
    CREATE TABLE IF NOT EXISTS cost_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0.0
    );
    CREATE INDEX IF NOT EXISTS idx_cost_history_ts ON cost_history(timestamp);

    -- Dead letter queue for failed event handler invocations
    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id TEXT PRIMARY KEY,
      envelope_json TEXT NOT NULL,
      error TEXT NOT NULL,
      stack TEXT,
      handler_name TEXT NOT NULL,
      message_type TEXT NOT NULL,
      failed_at TEXT NOT NULL DEFAULT (datetime('now')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_retry_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dlq_message_type ON dead_letter_queue(message_type);
    CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON dead_letter_queue(failed_at);
  `);
}
