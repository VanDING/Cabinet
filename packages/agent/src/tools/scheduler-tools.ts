import type { ToolDefinition } from '../tool-executor.js';

export interface SchedulerToolDeps {
  scheduleTask: (
    name: string,
    cronExpression: string,
    prompt: string,
    recurring: boolean,
  ) => Promise<{ id: string }>;
  listScheduledTasks: () => Promise<
    {
      id: string;
      name: string;
      cronExpression: string;
      prompt: string;
      recurring: boolean;
      enabled: boolean;
      lastRunAt?: string;
      nextRunAt?: string;
    }[]
  >;
  cancelScheduledTask: (id: string) => Promise<void>;
}

export function createSchedulerTools(deps: SchedulerToolDeps): ToolDefinition[] {
  return [
    {
      name: 'schedule_task',
      execute: async (args: Record<string, unknown>) => {
        const name = args.name as string;
        const cronExpression = args.cron as string;
        const prompt = args.prompt as string;
        const recurring = (args.recurring as boolean) ?? true;

        if (!name) return { error: 'name is required' };
        if (!cronExpression)
          return { error: 'cron is required (standard 5-field cron expression)' };
        if (!prompt) return { error: 'prompt is required' };

        try {
          const result = await deps.scheduleTask(name, cronExpression, prompt, recurring);
          return { scheduled: true, taskId: result.id, name, cron: cronExpression, recurring };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'list_scheduled_tasks',
      execute: async (_args: Record<string, unknown>) => {
        try {
          const tasks = await deps.listScheduledTasks();
          return { tasks, count: tasks.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'cancel_scheduled_task',
      execute: async (args: Record<string, unknown>) => {
        const id = args.taskId as string;
        if (!id) return { error: 'taskId is required' };
        try {
          await deps.cancelScheduledTask(id);
          return { cancelled: true, taskId: id };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
