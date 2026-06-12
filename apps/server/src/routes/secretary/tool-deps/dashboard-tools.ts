import type { ServerContext } from '../../../context.js';

export function buildDashboardTools(ctx: ServerContext, activeProjectId?: string) {
  return {
    getDashboardStats() {
      const pendingDecisions = ctx.decisionRepo.listAllPending().length;
      const activeWorkflows = ctx.workflowRepo.countByStatus(['running']);
      const activeProjects = ctx.projectRepo.listAll().filter((p) => !p.archived).length;
      const todayCost = ctx.costTracker.getDailyCost();
      const metrics = ctx.metrics.getSummary();
      const recentEvents = ctx.eventRepo
        .findAll()
        .slice(-10)
        .map((e) => ({
          message: e.messageType,
          time: e.timestamp instanceof Date ? e.timestamp.toISOString() : String(e.timestamp),
        }));
      return {
        pendingDecisions,
        activeWorkflows,
        activeProjects,
        todayCost,
        totalLLMCalls: metrics.totalLLMCalls,
        totalTokens: metrics.totalTokens,
        totalDecisions: metrics.totalDecisions,
        errors: metrics.errors,
        recentEvents,
      };
    },

    delegateTask(name: string, agentName?: string, description?: string) {
      return ctx.taskTracker.addTask(name, agentName, description);
    },
    getTaskStatus(taskId: string) {
      const task = ctx.taskTracker.getTask(taskId);
      if (!task) return null;
      return {
        id: task.id,
        name: task.name,
        status: task.status,
        startTime: task.startTime,
        endTime: task.endTime,
      };
    },
    listActiveTasks() {
      return ctx.taskTracker
        .listActive()
        .map((t) => ({ id: t.id, name: t.name, status: t.status }));
    },

    getDecisionAudit(decisionId: string) {
      const rows = ctx.auditLogRepo.findByEntity('decision', decisionId);
      return rows.map((r) => ({
        action: r.action,
        actor: r.actor,
        changes: (() => {
          try {
            return JSON.parse(r.changes ?? '{}');
          } catch {
            return {};
          }
        })(),
        timestamp: r.timestamp,
      }));
    },

    getSystemMetrics() {
      return ctx.metrics.getSummary();
    },

    generateEmbeddings: async (texts: string[]) => {
      if (!ctx.gateway) throw new Error('No LLM gateway available');
      const result = await ctx.gateway.generateEmbeddings({ texts });
      return result.embeddings;
    },
  };
}
