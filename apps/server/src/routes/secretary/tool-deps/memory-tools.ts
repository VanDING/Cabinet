import type { ServerContext } from '../../../context.js';

export function buildMemoryTools(ctx: ServerContext) {
  return {
    async writeLongTermMemory(content: string, metadata?: any) {
      // Auto-generate embedding for semantic search
      let embedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({ texts: [content] });
          embedding = result.embeddings[0];
        } catch {
          /* embedding generation failed — store without */
        }
      }
      return ctx.longTerm.store({
        content,
        metadata: metadata ?? {},
        embedding,
        timestamp: new Date(),
      });
    },
  };
}
