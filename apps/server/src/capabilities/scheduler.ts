import type { CapabilitiesContext } from './types.js';

export function createSchedulerCapabilities(ctx: CapabilitiesContext, defaultProjectId?: string) {
  return {
    scheduleTask: async (
      name: string,
      cronExpression: string,
      prompt: string,
      recurring: boolean,
    ) => {
      const id = `wf_${Date.now()}`;
      const def = {
        steps: [{ type: 'llm', title: name, data: { prompt } }],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'exec', type: 'llm', title: name, data: { prompt } },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'exec' },
          { from: 'exec', to: 'end' },
        ],
      };
      const projectId = defaultProjectId ?? ctx.projectRepo.listAll()[0]?.id ?? 'default';
      ctx.workflowRepo.create(
        id,
        projectId,
        name,
        JSON.stringify(def),
        'draft',
        recurring ? cronExpression : undefined,
      );
      if (recurring) {
        ctx.taskScheduler.schedule(id, name, cronExpression);
      }
      return { id };
    },
    listScheduledTasks: async () => {
      return ctx.taskScheduler.list();
    },
    cancelScheduledTask: async (id: string) => {
      ctx.taskScheduler.unschedule(id);
      ctx.workflowRepo.updateCron(id, null);
    },
  };
}
