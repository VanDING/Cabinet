import type Database from 'better-sqlite3';

export interface ApiKeyRow {
  id: string;
  provider: string;
  encrypted_key: string;
  key_type: string;
  created_at: string;
  last_used_at: string | null;
  base_url?: string;
  model?: string;
}

export class ApiKeyRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): ApiKeyRow[] {
    const rows = this.db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToApiKey(r));
  }

  findByProvider(provider: string): ApiKeyRow | null {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE provider = ?').get(provider) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToApiKey(row);
  }

  findById(id: string): ApiKeyRow | null {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToApiKey(row);
  }

  insert(key: ApiKeyRow): void {
    this.db
      .prepare(
        'INSERT INTO api_keys (id, provider, encrypted_key, key_type, created_at, last_used_at, base_url, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        key.id,
        key.provider,
        key.encrypted_key,
        key.key_type ?? 'api_key',
        key.created_at ?? new Date().toISOString(),
        key.last_used_at ?? null,
        key.base_url ?? null,
        key.model ?? null,
      );
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  }

  private rowToApiKey(row: Record<string, unknown>): ApiKeyRow {
    return {
      id: row.id as string,
      provider: row.provider as string,
      encrypted_key: row.encrypted_key as string,
      key_type: row.key_type as string,
      created_at: row.created_at as string,
      last_used_at: row.last_used_at as string | null,
      base_url: row.base_url as string | undefined,
      model: row.model as string | undefined,
    };
  }
}
