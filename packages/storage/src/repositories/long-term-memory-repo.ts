import type Database from 'better-sqlite3';

export interface LongTermMemoryRow {
  id: string;
  content: string;
  embedding: string | null;
  metadata: string;
  timestamp: string;
}

export class LongTermMemoryRepository {
  constructor(private readonly db: Database.Database) {}

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memory_timestamp ON memory_embeddings(timestamp);
    `);
  }

  insert(entry: {
    id: string;
    content: string;
    embedding?: string | null;
    metadata?: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO memory_embeddings (id, content, embedding, metadata) VALUES (?, ?, ?, ?)",
      )
      .run(entry.id, entry.content, entry.embedding ?? null, entry.metadata ?? '{}');
  }

  searchByText(query: string, limit = 10): LongTermMemoryRow[] {
    // Escape LIKE wildcards to prevent unintended pattern matching
    const escaped = query.replace(/[%_\\]/g, '\\$&');
    const rows = this.db
      .prepare(
        'SELECT * FROM memory_embeddings WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?',
      )
      .all(`%${escaped}%`, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  findAllWithEmbeddings(): LongTermMemoryRow[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_embeddings WHERE embedding IS NOT NULL')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM memory_embeddings')
      .get() as { count: number };
    return row.count;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM memory_embeddings WHERE id = ?').run(id);
  }

  private rowToEntry(row: Record<string, unknown>): LongTermMemoryRow {
    return {
      id: row.id as string,
      content: row.content as string,
      embedding: row.embedding as string | null,
      metadata: row.metadata as string,
      timestamp: row.timestamp as string,
    };
  }
}
