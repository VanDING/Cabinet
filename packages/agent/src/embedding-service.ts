import type { LLMGateway } from '@cabinet/gateway';

/**
 * Thin wrapper around LLMGateway.generateEmbeddings for semantic similarity.
 */
export class EmbeddingService {
  constructor(private gateway: LLMGateway) {}

  async embed(text: string): Promise<number[]> {
    const result = await this.gateway.generateEmbeddings({ texts: [text] });
    return result.embeddings?.[0] ?? [];
  }

  async cosineSimilarity(a: string, b: string): Promise<number> {
    const [embedA, embedB] = await Promise.all([this.embed(a), this.embed(b)]);
    if (embedA.length === 0 || embedB.length === 0) return 0;
    const dot = embedA.reduce((sum, v, i) => sum + v * (embedB[i] ?? 0), 0);
    const magA = Math.sqrt(embedA.reduce((sum, v) => sum + v * v, 0));
    const magB = Math.sqrt(embedB.reduce((sum, v) => sum + v * v, 0));
    return dot / (magA * magB || 1);
  }
}
