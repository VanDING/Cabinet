import type { ServerContext } from '../../../context.js';
import { createSystemKnowledgeCapabilities } from '../../../capabilities.js';

export function buildSystemKnowledgeTools(ctx: ServerContext) {
  const capsCtx = {
    db: ctx.db,
    gateway: ctx.gateway,
    logger: ctx.logger,
    taskScheduler: ctx.taskScheduler,
    workflowRepo: ctx.workflowRepo,
    projectRepo: ctx.projectRepo,
  };
  const sysKnowledge = createSystemKnowledgeCapabilities(capsCtx);
  return {
    querySystemKnowledge: async (query: string, limit?: number) => {
      return sysKnowledge.querySystemKnowledge(query, limit);
    },
    getSystemKnowledge: async (topic: string) => {
      return sysKnowledge.getSystemKnowledge(topic);
    },
  };
}
