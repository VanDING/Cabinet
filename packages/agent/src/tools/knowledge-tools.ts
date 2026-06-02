import type { ToolDefinition } from '../tool-executor.js';

export interface KnowledgeToolDeps {
  indexDocument: (
    filePath: string,
    projectId: string,
  ) => Promise<{ chunkCount: number; filePath: string }>;
  searchDocuments: (
    query: string,
    projectId: string,
    limit?: number,
  ) => Promise<{
    chunks: { content: string; sourcePath: string; chunkIndex: number; score: number }[];
  }>;
  clearDocumentIndex: (projectId: string, filePath?: string) => Promise<{ removed: number }>;
}

export function createKnowledgeTools(deps: KnowledgeToolDeps): ToolDefinition[] {
  return [
    {
      name: 'index_document',
      timeoutMs: 120000,
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const projectId = (args.projectId as string) ?? 'default';
        if (!filePath) return { error: 'path is required' };
        try {
          const result = await deps.indexDocument(filePath, projectId);
          return { indexed: true, path: result.filePath, chunks: result.chunkCount };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'search_documents',
      timeoutMs: 30000,
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const query = args.query as string;
        const projectId = (args.projectId as string) ?? 'default';
        const limit = (args.limit as number) ?? 5;
        if (!query) return { error: 'query is required' };
        try {
          const result = await deps.searchDocuments(query, projectId, limit);
          return {
            query,
            results: result.chunks.map((c) => ({
              content: c.content.slice(0, 1000),
              source: c.sourcePath,
              chunkIndex: c.chunkIndex,
              score: Math.round(c.score * 100) / 100,
            })),
            count: result.chunks.length,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'clear_index',
      parameters: { type: 'object', properties: {} },
      execute: async (args: Record<string, unknown>) => {
        const projectId = (args.projectId as string) ?? 'default';
        const filePath = args.path as string | undefined;
        try {
          const result = await deps.clearDocumentIndex(projectId, filePath);
          return { cleared: true, removed: result.removed };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
