import type { ToolDefinition } from '../tool-executor.js';

export interface SystemKnowledgeToolDeps {
  querySystemKnowledge: (query: string, limit?: number) => Promise<Array<{ topic: string; content: string; category: string }>>;
  getSystemKnowledge: (topic: string) => Promise<{ topic: string; content: string; category: string } | null>;
}

export function createSystemKnowledgeTools(deps: SystemKnowledgeToolDeps): ToolDefinition[] {
  return [
    {
      name: 'query_system_knowledge',
      description: 'Search the system knowledge base for information about system capabilities, directory structure, agent roles, or constraints. Use this when you are unsure about how the system works or where data should be stored.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query, e.g. "skill directory" or "scheduler cron"' },
          limit: { type: 'integer', description: 'Max results to return (default 5)', default: 5 },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const query = args.query as string;
        const limit = (args.limit as number) ?? 5;
        if (!query) return { error: 'query is required' };
        try {
          const results = await deps.querySystemKnowledge(query, limit);
          return { results, count: results.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'get_system_knowledge',
      description: 'Retrieve a specific system knowledge entry by its topic identifier. Use this for precise lookups when you know the topic name.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Exact topic identifier, e.g. "directory_structure" or "scheduler_capabilities"' },
        },
        required: ['topic'],
      },
      execute: async (args) => {
        const topic = args.topic as string;
        if (!topic) return { error: 'topic is required' };
        try {
          const result = await deps.getSystemKnowledge(topic);
          if (!result) return { error: `No knowledge found for topic: ${topic}` };
          return result;
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
