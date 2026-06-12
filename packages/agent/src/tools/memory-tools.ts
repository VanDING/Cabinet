import type { ToolDefinition } from '../tool-executor.js';
import type { ToolDependencies } from './tool-dependencies.js';

export function createMemoryTools(deps: ToolDependencies): ToolDefinition[] {
  return [
    // ═══════════════════════════════════════════════════════════
    // Memory Tools (read + write)
    // ═══════════════════════════════════════════════════════════
    {
      name: 'remember',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID for scoping this memory' },
          key: { type: 'string', description: 'Key to store the value under' },
          value: { description: 'The value to remember (any JSON-compatible value)' },
          ttlMs: { type: 'integer', description: 'Optional time-to-live in milliseconds' },
        },
        required: ['sessionId', 'key', 'value'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.sessionId as string;
        const key = args.key as string;
        const value = args.value;
        deps.shortTerm.set(sessionId, key, value, (args.ttlMs as number) ?? undefined);
        return { remembered: true, key };
      },
    },
    {
      name: 'recall',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID to recall from' },
          key: { type: 'string', description: 'Specific key to recall, or omit to get all keys' },
        },
        required: ['sessionId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.sessionId as string;
        const key = args.key as string | undefined;
        if (key) {
          const val = deps.shortTerm.get(sessionId, key);
          return val !== null ? { key, value: val } : { key, notFound: true };
        }
        return deps.shortTerm.getAll(sessionId);
      },
    },
    {
      name: 'search_memory',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language search query for long-term memory',
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of results (default 20)',
            default: 20,
          },
        },
        required: ['query'],
      },
      execute: async (args: Record<string, unknown>) => {
        const query = args.query as string;
        const limit = (args.limit as number) ?? 20;
        let queryEmbedding: number[] | undefined;
        try {
          const embeddings = await deps.generateEmbeddings([query]);
          queryEmbedding = embeddings[0];
        } catch {
          /* fall back to text-only search */
        }
        const results = await deps.longTerm.search(query, limit, queryEmbedding);
        return results.map((r) => ({
          content: r.content,
          timestamp: r.timestamp,
          metadata: r.metadata,
        }));
      },
    },
    {
      name: 'list_memories',
      timeoutMs: 15000,
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum results (default 20, max 100)',
            default: 20,
          },
          offset: { type: 'integer', description: 'Pagination offset (default 0)', default: 0 },
          status: {
            type: 'string',
            description: "Filter: 'active' (default), 'expired', 'archived', or 'all'",
          },
        },
        required: [],
      },
      execute: async (args: Record<string, unknown>) => {
        const limit = Math.min((args.limit as number) ?? 20, 100);
        const offset = (args.offset as number) ?? 0;
        const statusFilter = (args.status as string) ?? 'active';
        const all = deps.longTerm.findAll(limit + offset, 0);
        const filtered =
          statusFilter === 'all'
            ? all
            : all.filter((r) => {
                const s = r.metadata.status as string | undefined;
                if (statusFilter === 'active') return !s || (s !== 'expired' && s !== 'archived');
                return s === statusFilter;
              });
        const sliced = filtered.slice(offset, offset + limit);
        return {
          memories: sliced.map((r) => ({
            id: r.id,
            content: r.content.slice(0, 500),
            timestamp: r.timestamp,
            metadata: r.metadata,
          })),
          total: filtered.length,
          hasMore: offset + limit < filtered.length,
        };
      },
    },
    {
      name: 'write_memory',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Memory content to store (minimum 10 characters)',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata key-value pairs attached to the memory',
          },
        },
        required: ['content'],
      },
      execute: async (args: Record<string, unknown>) => {
        const content = args.content as string;
        const metadata = (args.metadata as Record<string, unknown>) ?? {};
        if (!content || content.length < 10) {
          return { error: 'Content must be at least 10 characters' };
        }
        const id = await deps.writeLongTermMemory(content, metadata);
        return { stored: true, id, preview: content.slice(0, 200) };
      },
    },
    {
      name: 'update_memory',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'ID of the memory entry to update' },
          status: {
            type: 'string',
            description: 'New status value (e.g. "superseded", "archived")',
          },
          importance: { type: 'number', description: 'Importance score for decay weighting' },
          confidence: { type: 'number', description: 'Confidence score for the stored fact' },
        },
        required: ['memoryId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const memoryId = args.memoryId as string;
        const status = args.status as string | undefined;
        const importance = args.importance as number | undefined;
        const confidence = args.confidence as number | undefined;
        if (!memoryId) return { error: 'memoryId is required' };
        const success = await deps.longTerm.updateMemory(memoryId, {
          status,
          importance,
          confidence,
        });
        return { updated: success, memoryId };
      },
    },
    {
      name: 'delete_memory',
      parameters: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'ID of the memory entry to delete' },
        },
        required: ['memoryId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const memoryId = args.memoryId as string;
        if (!memoryId) return { error: 'memoryId is required' };
        const success = await deps.longTerm.delete(memoryId);
        return { deleted: success, memoryId };
      },
    },
  ];
}
