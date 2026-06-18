import { describe, it, expect } from 'vitest';
import { BM25Index, HybridRetriever } from '../hybrid-retriever.js';
import type { Chunk } from '../chunking.js';

class FakeEmbedder {
  async generateEmbeddings(opts: { texts: string[] }): Promise<{ embeddings: number[][] }> {
    // Deterministic fake embeddings based on text length
    const embeddings = opts.texts.map((t) => {
      const vec = new Array(8).fill(0);
      for (let i = 0; i < t.length; i++) {
        vec[i % 8] = (vec[i % 8]! + t.charCodeAt(i)) % 100;
      }
      return vec.map((v) => v / 100);
    });
    return { embeddings };
  }
}

describe('BM25Index', () => {
  it('indexes and searches documents', () => {
    const index = new BM25Index();
    index.addDocument('d1', 'The quick brown fox jumps over the lazy dog');
    index.addDocument('d2', 'A quick cat sleeps on the mat');
    const results = index.search('quick fox', 5);
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe('d1');
  });

  it('returns empty for no matches', () => {
    const index = new BM25Index();
    index.addDocument('d1', 'hello world');
    expect(index.search('xyzabc', 5)).toEqual([]);
  });
});

describe('HybridRetriever', () => {
  it('indexes chunks and retrieves via hybrid search', async () => {
    const retriever = new HybridRetriever(new FakeEmbedder());
    const chunks: Chunk[] = [
      { id: 'c1', text: 'The quick brown fox jumps over the lazy dog', index: 0 },
      { id: 'c2', text: 'Machine learning is a subset of artificial intelligence', index: 1 },
      { id: 'c3', text: 'Deep learning uses neural networks with many layers', index: 2 },
    ];
    await retriever.index(chunks);

    const results = await retriever.search('neural networks', 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunk.id).toBe('c3');
  });
});
