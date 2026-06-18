import type { ServerContext } from '../../../context.js';
import { DocumentChunkRepository } from '@cabinet/storage';
import {
  resolveSafePath,
  readTextFile,
  chunkText,
  cosineSimilarity,
} from '../../../capabilities/helpers.js';

export function buildKnowledgeTools(ctx: ServerContext) {
  return {
    indexDocument: async (filePath: string, projectId: string) => {
      const safePath = await resolveSafePath(filePath);
      const content = await readTextFile(safePath);
      if (content.length === 0) throw new Error('File is empty');

      // Clear previous chunks for this file
      new DocumentChunkRepository(ctx.db).deleteByPath(projectId, filePath);

      // Chunk the content
      const chunks = chunkText(content, 800, 100);
      if (chunks.length === 0) throw new Error('No chunks produced');

      // Generate embeddings for each chunk
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

      // Store chunks
      const chunkRepo = new DocumentChunkRepository(ctx.db);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        chunkRepo.insert({
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
      // Try semantic search first
      let queryEmbedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({ texts: [query] });
          queryEmbedding = result.embeddings[0];
        } catch {
          /* fall back to text search */
        }
      }

      const rows = ctx.db
        .prepare('SELECT * FROM document_chunks WHERE project_id = ?')
        .all(projectId) as any[];

      if (rows.length === 0) return { chunks: [] };

      if (queryEmbedding) {
        // Semantic search
        const scored = rows
          .map((row: any) => {
            const emb = row.embedding ? (JSON.parse(row.embedding) as number[]) : null;
            const score = emb ? cosineSimilarity(queryEmbedding!, emb) : 0;
            return {
              content: row.content as string,
              sourcePath: row.source_path as string,
              chunkIndex: row.chunk_index as number,
              score,
            };
          })
          .filter((c) => c.score > 0.25)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit ?? 5);
        return { chunks: scored };
      }

      // Text search fallback
      const lower = query.toLowerCase();
      const scored = rows
        .filter((row: any) => (row.content as string).toLowerCase().includes(lower))
        .slice(0, limit ?? 5)
        .map((row: any) => ({
          content: row.content as string,
          sourcePath: row.source_path as string,
          chunkIndex: row.chunk_index as number,
          score: 0.5,
        }));
      return { chunks: scored };
    },

    clearDocumentIndex: async (projectId: string, filePath?: string) => {
      if (filePath) {
        const result = ctx.db
          .prepare('DELETE FROM document_chunks WHERE project_id = ? AND source_path = ?')
          .run(projectId, filePath);
        return { removed: result.changes };
      }
      const result = ctx.db
        .prepare('DELETE FROM document_chunks WHERE project_id = ?')
        .run(projectId);
      return { removed: result.changes };
    },
  };
}
