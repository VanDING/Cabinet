import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { toolServices } from './tool-context.js';

export const getSystemStatusTool = createTool({
  id: 'getSystemStatus',
  description: 'Get overall system health and status',
  inputSchema: z.object({}),
  execute: async () => {
    return {
      status: 'online',
      agents: toolServices.agentRegistry.list().length,
    };
  },
});

export const getDashboardStatsTool = createTool({
  id: 'getDashboardStats',
  description: 'Get dashboard statistics',
  inputSchema: z.object({}),
  execute: async () => {
    return {
      decisions: 0,
      projects: 0,
      agents: toolServices.agentRegistry.list().length,
      uptime: process.uptime(),
    };
  },
});

export const getMemoryStatsTool = createTool({
  id: 'getMemoryStats',
  description: 'Get memory system statistics',
  inputSchema: z.object({}),
  execute: async () => {
    return {
      status: 'active',
      type: 'mastra-observational-memory',
    };
  },
});
