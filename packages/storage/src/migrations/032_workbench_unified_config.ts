import type Database from 'better-sqlite3';

export function runMigration032(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      name TEXT PRIMARY KEY,
      transport_type TEXT NOT NULL,
      command TEXT,
      args TEXT,
      env TEXT,
      url TEXT,
      headers TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      health_status TEXT,
      last_health_check INTEGER,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const row = db.prepare("SELECT value FROM settings WHERE key = 'mcp_servers'").get() as
    | { value?: string }
    | undefined;
  if (row?.value) {
    try {
      const servers = JSON.parse(row.value) as Array<{
        name: string;
        transport: {
          type: string;
          command?: string;
          args?: string[];
          url?: string;
          env?: Record<string, string>;
        };
      }>;
      const insert = db.prepare(
        "INSERT OR IGNORE INTO mcp_servers (name, transport_type, command, args, env, url, source) VALUES (?, ?, ?, ?, ?, ?, 'scanned')",
      );
      for (const s of servers) {
        insert.run(
          s.name,
          s.transport.type,
          s.transport.command ?? null,
          s.transport.args ? JSON.stringify(s.transport.args) : null,
          s.transport.env ? JSON.stringify(s.transport.env) : null,
          s.transport.url ?? null,
        );
      }
    } catch {
      /* malformed settings.mcp_servers — skip */
    }
  }

  const externalRows = db
    .prepare(
      "SELECT name, type FROM agent_roles WHERE type LIKE 'external_%' AND external_config IS NULL",
    )
    .all() as { name: string; type: string }[];
  const update = db.prepare('UPDATE agent_roles SET external_config = ? WHERE name = ?');
  for (const r of externalRows) {
    const command = r.name.startsWith('external_cli:') ? r.name.slice('external_cli:'.length) : '';
    const stub = JSON.stringify({
      protocol: 'cli',
      configSource: 'agent_native',
      command,
      dispatchProtocol: 'headless',
    });
    update.run(stub, r.name);
  }
}
