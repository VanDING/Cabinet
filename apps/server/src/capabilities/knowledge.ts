import { DocumentChunkRepository } from '@cabinet/storage';
import type { CapabilitiesContext } from './types.js';
import {
  readTextFile,
  resolveSafePath,
  chunkText,
  cosineSimilarity,
  RAG_DEFAULT_TOP_K,
} from './helpers.js';

export function createKnowledgeCapabilities(ctx: CapabilitiesContext) {
  return {
    indexDocument: async (filePath: string, projectId: string) => {
      const safePath = await resolveSafePath(filePath);
      const content = await readTextFile(safePath);
      if (content.length === 0) throw new Error('File is empty');

      const chunksRepo = new DocumentChunkRepository(ctx.db);
      chunksRepo.deleteByPath(projectId, filePath);

      const chunks = chunkText(content, 800, 100);
      if (chunks.length === 0) throw new Error('No chunks produced');

      let embeddings: number[][] = [];
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({
            texts: chunks.map((c) => c.content),
          });
          embeddings = result.embeddings;
        } catch {
          // Store without embeddings — text search fallback
        }
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        chunksRepo.insert({
          project_id: projectId,
          source_path: filePath,
          chunk_index: i,
          content: chunk.content,
          embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
          metadata: JSON.stringify({ startChar: chunk.startChar, endChar: chunk.endChar }),
        });
      }
      ctx.logger.info('Document indexed', { path: filePath, chunks: chunks.length, projectId });
      return { chunkCount: chunks.length, filePath };
    },

    searchDocuments: async (query: string, projectId: string, limit?: number) => {
      let queryEmbedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({ texts: [query] });
          queryEmbedding = result.embeddings[0];
        } catch {
          /* fall back to text search */
        }
      }

      const chunksRepo = new DocumentChunkRepository(ctx.db);
      const rows = chunksRepo.findByProject(projectId);

      if (rows.length === 0) return { chunks: [] };

      if (queryEmbedding) {
        const scored = rows
          .map((row) => {
            const emb = row.embedding ? (JSON.parse(row.embedding) as number[]) : null;
            const score = emb ? cosineSimilarity(queryEmbedding!, emb) : 0;
            return {
              content: row.content,
              sourcePath: row.source_path,
              chunkIndex: row.chunk_index,
              score,
            };
          })
          .filter((c) => c.score > 0.4)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit ?? RAG_DEFAULT_TOP_K);
        return { chunks: scored };
      }

      const lower = query.toLowerCase();
      const scored = rows
        .filter((row) => row.content.toLowerCase().includes(lower))
        .slice(0, limit ?? RAG_DEFAULT_TOP_K)
        .map((row) => ({
          content: row.content,
          sourcePath: row.source_path,
          chunkIndex: row.chunk_index,
          score: 0.5,
        }));
      return { chunks: scored };
    },

    clearDocumentIndex: async (projectId: string, filePath?: string) => {
      const chunksRepo = new DocumentChunkRepository(ctx.db);
      if (filePath) {
        chunksRepo.deleteByPath(projectId, filePath);
        return { removed: -1 };
      }
      chunksRepo.deleteByProject(projectId);
      return { removed: -1 };
    },
  };
}
