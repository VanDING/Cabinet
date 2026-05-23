import type Database from 'better-sqlite3';

export function runMigration001(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('ai', 'human')),
      pipeline_config TEXT,
      persona TEXT,
      permission_level TEXT NOT NULL DEFAULT 'read'
    );
    CREATE INDEX IF NOT EXISTS idx_employees_project ON employees(project_id);

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      type TEXT NOT NULL CHECK(type IN ('strategic', 'action', 'execution', 'anomaly', 'evolution')),
      level TEXT NOT NULL CHECK(level IN ('L0', 'L1', 'L2', 'L3')),
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '[]',
      chosen_option_id TEXT,
      captain_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_project_status ON decisions(project_id, status);

    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL UNIQUE,
      correlation_id TEXT NOT NULL,
      causation_id TEXT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_event_log_correlation ON event_log(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_event_log_causation ON event_log(causation_id);
    CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(type);
    CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK(kind IN ('tool', 'prompt', 'composite')),
      input_schema TEXT NOT NULL DEFAULT '{}',
      output_schema TEXT NOT NULL DEFAULT '{}',
      prompt_template TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft'
    );

    CREATE TABLE IF NOT EXISTS agent_roles (
      type TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
      temperature REAL NOT NULL DEFAULT 0.3,
      max_response_tokens INTEGER NOT NULL DEFAULT 4000,
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      context_budget REAL NOT NULL DEFAULT 0.4,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      definition TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      key_type TEXT NOT NULL DEFAULT 'api_key',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      changes TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      value REAL NOT NULL,
      tags TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function trackMigration(db: Database.Database, version: number): void {
  db.prepare(
    'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, datetime(\'now\'))',
  ).run(version);
}
