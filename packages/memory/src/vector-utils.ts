/**
 * Shared vector math utilities for the memory system.
 *
 * Consolidates three independent implementations of cosine similarity
 * that existed in write-gate.ts, long-term.ts, and hybrid-retriever.ts.
 */

/** Epsilon to prevent division by zero in cosine similarity. */
const EPSILON = 1e-10;

/**
 * Cosine similarity between two vectors.
 * Returns 0 on length mismatch or zero-vector inputs.
 * Epsilon-stabilized to prevent division by zero on near-zero vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + EPSILON);
}

/**
 * Minimal embedding gateway — canonical interface for all embedding operations.
 * Consolidated from EmbeddingGatewayLike (memory-facade.ts), EmbeddingProvider (write-gate.ts),
 * and SimpleEmbedder (hybrid-retriever.ts).
 */
export interface EmbeddingGateway {
  generateEmbeddings(opts: { texts: string[] }): Promise<{ embeddings: number[][] }>;
}
