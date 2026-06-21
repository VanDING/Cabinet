import type Database from 'better-sqlite3';

export interface McpServerRow {
  name: string;
  transport_type: string;
  command: string | null;
  args: string | null;
  env: string | null;
  url: string | null;
  headers: string | null;
  enabled: number;
  health_status: string | null;
  last_health_check: number | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export class McpServerRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): McpServerRow[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY name ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToServer(r));
  }

  findByName(name: string): McpServerRow | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(name) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToServer(row);
  }

  upsert(server: {
    name: string;
    transport_type: string;
    command?: string;
    args?: string;
    env?: string;
    url?: string;
    headers?: string;
    source?: string;
  }): void {
    this.db
      .prepare(
        `
      INSERT INTO mcp_servers (name, transport_type, command, args, env, url, headers, source, enabled, health_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'unknown', datetime('now'), datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        transport_type = excluded.transport_type,
        command = excluded.command,
        args = excluded.args,
        env = excluded.env,
        url = excluded.url,
        headers = excluded.headers,
        source = excluded.source,
        updated_at = datetime('now')
    `,
      )
      .run(
        server.name,
        server.transport_type,
        server.command ?? null,
        server.args ?? null,
        server.env ?? null,
        server.url ?? null,
        server.headers ?? null,
        server.source ?? 'user',
      );
  }

  delete(name: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE name = ?').run(name);
  }

  private rowToServer(row: Record<string, unknown>): McpServerRow {
    return {
      name: row.name as string,
      transport_type: row.transport_type as string,
      command: row.command as string | null,
      args: row.args as string | null,
      env: row.env as string | null,
      url: row.url as string | null,
      headers: row.headers as string | null,
      enabled: row.enabled as number,
      health_status: row.health_status as string | null,
      last_health_check: row.last_health_check as number | null,
      source: row.source as string | null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
