import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { toolServices } from './tool-context.js';

export const scheduleTaskTool = createTool({
  id: 'scheduleTask',
  description: 'Create a cron-scheduled task',
  inputSchema: z.object({
    name: z.string(),
    cron: z.string(),
    action: z.string(),
  }),
  execute: async ({ name, cron, action }) => {
    return { scheduled: true, name, cron };
  },
});

export const listScheduledTasksTool = createTool({
  id: 'listScheduledTasks',
  description: 'List all cron-scheduled tasks',
  inputSchema: z.object({}),
  execute: async () => {
    return { tasks: [] };
  },
});

export const cancelScheduledTaskTool = createTool({
  id: 'cancelScheduledTask',
  description: 'Cancel a cron-scheduled task',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    return { cancelled: true, id };
  },
});
