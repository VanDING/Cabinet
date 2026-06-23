import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { toolServices } from './tool-context.js';

export const getProjectContextTool = createTool({
  id: 'getProjectContext',
  description: 'Get project context from the knowledge base',
  inputSchema: z.object({ projectId: z.string() }),
  execute: async ({ projectId }) => {
    const ctx = toolServices.memory.getProject(projectId);
    return { context: ctx };
  },
});

export const updateProjectSummaryTool = createTool({
  id: 'updateProjectSummary',
  description: 'Update a project summary',
  inputSchema: z.object({ projectId: z.string(), summary: z.string() }),
  execute: async ({ projectId, summary }) => {
    toolServices.memory.updateProjectSummary(projectId, summary);
    return { success: true };
  },
});

export const addMilestoneTool = createTool({
  id: 'addMilestone',
  description: 'Add a milestone to a project',
  inputSchema: z.object({ projectId: z.string(), title: z.string() }),
  execute: async ({ projectId, title }) => {
    toolServices.memory.addProjectMilestone(projectId, title);
    return { success: true };
  },
});

export const getPreferencesTool = createTool({
  id: 'getPreferences',
  description: 'Get user preferences',
  inputSchema: z.object({ entityId: z.string() }),
  execute: async ({ entityId }) => {
    const prefs = toolServices.memory.getPreferences(entityId);
    return { preferences: prefs };
  },
});

export const setPreferencesTool = createTool({
  id: 'setPreferences',
  description: 'Set user preferences',
  inputSchema: z.object({ entityId: z.string(), preferences: z.record(z.string(), z.unknown()) }),
  execute: async ({ entityId, preferences }) => {
    toolServices.memory.setPreferences(entityId, preferences);
    return { success: true };
  },
});
