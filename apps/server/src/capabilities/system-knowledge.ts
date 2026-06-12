import { SystemKnowledgeRepository } from '@cabinet/storage';
import type { CapabilitiesContext } from './types.js';

export function createSystemKnowledgeCapabilities(ctx: CapabilitiesContext) {
  const repo = new SystemKnowledgeRepository(ctx.db);
  return {
    querySystemKnowledge: async (query: string, limit?: number) => {
      return repo.search(query, limit ?? 5);
    },
    getSystemKnowledge: async (topic: string) => {
      return repo.findByTopic(topic) ?? null;
    },
  };
}
