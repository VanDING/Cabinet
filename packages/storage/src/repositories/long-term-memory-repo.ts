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
      CREATE INDEX IF NOT EXISTS idx_memory_metadata_project ON memory_embeddings(json_extract(metadata, '$.projectId'));
      CREATE INDEX IF NOT EXISTS idx_memory_has_embedding ON memory_embeddings(embedding) WHERE embedding IS NOT NULL;

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content_rowid=rowid);
      CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_embeddings BEGIN
        INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_embeddings BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memory_embeddings BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
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

  searchByBM25(query: string, limit = 10): LongTermMemoryRow[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT m.* FROM memory_embeddings m
           JOIN memory_fts f ON m.rowid = f.rowid
           WHERE memory_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as Record<string, unknown>[];
      return rows.map((r) => this.rowToEntry(r));
    } catch {
      // Fallback to LIKE if FTS5 is unavailable or query is malformed
      return this.searchByText(query, limit);
    }
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

  findByMetadataFilter(filter: Record<string, unknown>, limit = 10): LongTermMemoryRow[] {
    const conditions: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(filter)) {
      conditions.push(`json_extract(metadata, '$.${key}') = ?`);
      values.push(val);
    }
    if (conditions.length === 0) {
      return this.searchByText('', limit);
    }
    const sql = `SELECT * FROM memory_embeddings WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC LIMIT ?`;
    values.push(limit);
    const rows = this.db.prepare(sql).all(...values) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  findWithEmbeddingsPaged(limit: number, offset: number): LongTermMemoryRow[] {
    const rows = this.db
      .prepare('SELECT * FROM memory_embeddings WHERE embedding IS NOT NULL ORDER BY timestamp DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  findByIds(ids: string[]): LongTermMemoryRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM memory_embeddings WHERE id IN (${placeholders})`)
      .all(...ids) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntry(r));
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM memory_embeddings WHERE id = ?').run(id);
  }

  updateMetadata(id: string, metadata: string): void {
    this.db
      .prepare('UPDATE memory_embeddings SET metadata = ? WHERE id = ?')
      .run(metadata, id);
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
