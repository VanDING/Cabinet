import type { Chunk } from './chunking.js';

/**
 * BM25 index — pure TypeScript, zero dependencies.
 *
 * IDF * TF * (k1 + 1) / (TF + k1 * (1 - b + b * DL / avgDL))
 */
export class BM25Index {
  private docs: Map<string, { terms: string[]; length: number }> = new Map();
  private df: Map<string, number> = new Map();
  private totalLength = 0;
  private k1 = 1.5;
  private b = 0.75;

  addDocument(id: string, text: string): void {
    const terms = tokenize(text);
    this.docs.set(id, { terms, length: terms.length });
    this.totalLength += terms.length;
    const unique = new Set(terms);
    for (const t of unique) {
      this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
  }

  search(query: string, topK: number): { id: string; score: number }[] {
    const qTerms = tokenize(query);
    const avgDL = this.totalLength / Math.max(this.docs.size, 1);
    const results: { id: string; score: number }[] = [];

    for (const [id, doc] of this.docs) {
      let score = 0;
      for (const term of qTerms) {
        const tf = doc.terms.filter((t) => t === term).length;
        if (tf === 0) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log((this.docs.size - df + 0.5) / (df + 0.5) + 1);
        const tfNorm =
          (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (doc.length / avgDL)));
        score += idf * tfNorm;
      }
      if (score > 0) results.push({ id, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  size(): number {
    return this.docs.size;
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

import { cosineSimilarity, type EmbeddingGateway } from './vector-utils.js';

/** @deprecated Use EmbeddingGateway from vector-utils. */
export type SimpleEmbedder = EmbeddingGateway;

/**
 * Hybrid retriever — BM25 + embedding similarity merged via RRF.
 */
export class HybridRetriever {
  private bm25 = new BM25Index();
  private chunks: Map<string, Chunk> = new Map();
  private embeddings: Map<string, number[]> = new Map();

  constructor(private embedder: SimpleEmbedder) {}

  async index(chunks: Chunk[]): Promise<void> {
    // Add to BM25
    for (const c of chunks) {
      this.bm25.addDocument(c.id, c.text);
      this.chunks.set(c.id, c);
    }

    // Compute embeddings in batches of 16
    const batchSize = 16;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const result = await this.embedder.generateEmbeddings({ texts: batch.map((c) => c.text) });
      const vectors = result.embeddings;
      for (let j = 0; j < batch.length; j++) {
        this.embeddings.set(batch[j]!.id, vectors[j]!);
      }
    }
  }

  async search(query: string, topK = 5): Promise<Array<{ chunk: Chunk; score: number }>> {
    const bm25Results = this.bm25.search(query, 20);
    const bm25Ranks = new Map<string, number>();
    bm25Results.forEach((r, i) => bm25Ranks.set(r.id, i + 1));

    // Semantic search
    const queryResult = await this.embedder.generateEmbeddings({ texts: [query] });
    const queryEmbedding = queryResult.embeddings[0]!;
    const semanticScores: { id: string; score: number }[] = [];
    for (const [id, vec] of this.embeddings) {
      const score = cosineSimilarity(queryEmbedding, vec);
      semanticScores.push({ id, score });
    }
    semanticScores.sort((a, b) => b.score - a.score);
    const semanticRanks = new Map<string, number>();
    semanticScores.slice(0, 10).forEach((r, i) => semanticRanks.set(r.id, i + 1));

    // RRF merge (Reciprocal Rank Fusion)
    const k = 60;
    const merged = new Map<string, number>();
    const allIds = new Set([...bm25Ranks.keys(), ...semanticRanks.keys()]);

    for (const id of allIds) {
      const bm25Rank = bm25Ranks.get(id);
      const semRank = semanticRanks.get(id);
      let score = 0;
      if (bm25Rank != null) score += 1 / (k + bm25Rank);
      if (semRank != null) score += 1 / (k + semRank);
      merged.set(id, score);
    }

    const sorted = Array.from(merged.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return sorted.map(([id, score]) => ({
      chunk: this.chunks.get(id)!,
      score,
    }));
  }
}
