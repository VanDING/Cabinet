import { LongTermMemoryRepository, type Database } from '@cabinet/storage';

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
  private repo: LongTermMemoryRepository;

  constructor(db: Database) {
    this.repo = new LongTermMemoryRepository(db);
    this.repo.ensureTable();
  }

  async store(entry: Omit<LongTermEntry, 'id'>): Promise<string> {
    const id = `ltm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const embeddingJson = entry.embedding ? JSON.stringify(entry.embedding) : null;

    this.repo.insert({
      id,
      content: entry.content,
      embedding: embeddingJson,
      metadata: JSON.stringify(entry.metadata),
    });

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

    // Text search supplements semantic results
    const textLimit = limit - results.length;
    if (textLimit > 0) {
      const rows = this.repo.searchByText(query, limit + 5);

      for (const r of rows) {
        if (results.length >= limit) break;
        if (!semanticIds.has(r.id)) {
          results.push({
            id: r.id, content: r.content,
            embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
            metadata: JSON.parse(r.metadata ?? '{}'),
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
    const rows = this.repo.findAllWithEmbeddings();

    const scored = rows.map((row) => {
      const embedding = JSON.parse(row.embedding!) as number[];
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
        embedding: JSON.parse(s.row.embedding!),
        metadata: JSON.parse(s.row.metadata ?? '{}'),
        timestamp: new Date(s.row.timestamp),
        score: s.score,
      }));
  }

  async delete(id: string): Promise<boolean> {
    const before = this.repo.count();
    this.repo.delete(id);
    return this.repo.count() < before;
  }

  size(): number {
    return this.repo.count();
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
