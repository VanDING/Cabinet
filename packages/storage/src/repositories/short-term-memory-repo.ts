import type Database from 'better-sqlite3';

export interface ShortTermMemoryRow {
  session_id: string;
  key: string;
  value: string;
  timestamp: string;
  ttl: number;
}

export class ShortTermMemoryRepository {
  constructor(private readonly db: Database.Database) {}

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS short_term (
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        ttl INTEGER NOT NULL DEFAULT 1800000,
        PRIMARY KEY (session_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_short_term_session ON short_term(session_id);
    `);
  }

  upsert(sessionId: string, key: string, value: string, ttl: number): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO short_term (session_id, key, value, timestamp, ttl) VALUES (?, ?, ?, datetime('now'), ?)",
      )
      .run(sessionId, key, value, ttl);
  }

  findBySessionAndKey(sessionId: string, key: string): ShortTermMemoryRow | null {
    const row = this.db
      .prepare('SELECT * FROM short_term WHERE session_id = ? AND key = ?')
      .get(sessionId, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  findBySession(sessionId: string): ShortTermMemoryRow[] {
    const rows = this.db
      .prepare('SELECT * FROM short_term WHERE session_id = ?')
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  delete(sessionId: string, key: string): void {
    this.db.prepare('DELETE FROM short_term WHERE session_id = ? AND key = ?').run(sessionId, key);
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM short_term WHERE session_id = ?').run(sessionId);
  }

  private rowToEntry(row: Record<string, unknown>): ShortTermMemoryRow {
    return {
      session_id: row.session_id as string,
      key: row.key as string,
      value: row.value as string,
      timestamp: row.timestamp as string,
      ttl: row.ttl as number,
    };
  }
}
