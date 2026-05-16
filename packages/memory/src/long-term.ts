import Database from 'better-sqlite3';

export interface LongTermEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface SimilarityResult extends LongTermEntry {
  score: number;
}

/**
 * Long-term memory backed by SQLite with optional embedding-based semantic search.
 * Supports both text search (LIKE queries) and vector similarity search (cosine similarity).
 */
export class LongTermMemory {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureTable();
  }

  private ensureTable(): void {
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

  async store(entry: Omit<LongTermEntry, 'id'>): Promise<string> {
    const id = `ltm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const embeddingJson = entry.embedding ? JSON.stringify(entry.embedding) : null;

    this.db
      .prepare(
        `INSERT INTO memory_embeddings (id, content, embedding, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.content,
        embeddingJson,
        JSON.stringify(entry.metadata),
        entry.timestamp.toISOString(),
      );

    return id;
  }

  /**
   * Text-based search using SQL LIKE. Matches against content and metadata JSON.
   * Maintains backward compatibility with the original interface.
   */
  async search(query: string, limit = 5, queryEmbedding?: number[]): Promise<LongTermEntry[]> {
    // Semantic search first (if embedding provided)
    const semanticIds = new Set<string>();
    const results: LongTermEntry[] = [];

    if (queryEmbedding) {
      const semantic = await this.semanticSearch(queryEmbedding, limit);
      for (const r of semantic) {
        semanticIds.add(r.id);
        results.push({
          id: r.id, content: r.content, embedding: r.embedding,
          metadata: r.metadata, timestamp: r.timestamp,
        });
      }
    }

    // Text LIKE search supplements semantic results
    const textLimit = limit - results.length;
    if (textLimit > 0) {
      const rows = this.db
        .prepare(
          `SELECT * FROM memory_embeddings
         WHERE content LIKE ? OR metadata LIKE ?
         ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(`%${query}%`, `%${query}%`, limit + 5) as any[];

      for (const r of rows) {
        if (results.length >= limit) break;
        if (!semanticIds.has(r.id)) {
          results.push({
            id: r.id, content: r.content,
            embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
            metadata: JSON.parse(r.metadata),
            timestamp: new Date(r.timestamp),
          });
        }
      }
    }

    return results;
  }

  /**
   * Semantic vector similarity search using cosine similarity.
   * Only searches entries that have embeddings stored.
   */
  async semanticSearch(queryEmbedding: number[], limit = 5): Promise<SimilarityResult[]> {
    const rows = this.db
      .prepare('SELECT * FROM memory_embeddings WHERE embedding IS NOT NULL')
      .all() as any[];

    const scored = rows.map((row) => {
      const embedding = JSON.parse(row.embedding) as number[];
      const score = this.cosineSimilarity(queryEmbedding, embedding);
      return { row, score };
    });

    return scored
      .filter((s) => s.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => ({
        id: s.row.id,
        content: s.row.content,
        embedding: JSON.parse(s.row.embedding),
        metadata: JSON.parse(s.row.metadata),
        timestamp: new Date(s.row.timestamp),
        score: s.score,
      }));
  }

  async delete(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memory_embeddings WHERE id = ?').run(id);
    return result.changes > 0;
  }

  size(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM memory_embeddings').get() as any;
    return row.count;
  }

  /** Database is managed externally — close is a no-op. */
  close(): void {
    // DB lifecycle is managed by @cabinet/storage
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
