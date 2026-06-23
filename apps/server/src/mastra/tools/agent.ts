import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { toolServices } from './tool-context.js';

export const listAgentsTool = createTool({
  id: 'listExternalAgents',
  description: 'List all registered external agents',
  inputSchema: z.object({}),
  execute: async () => {
    const agents = toolServices.agentRegistry.list();
    return { agents };
  },
});

export const registerAgentTool = createTool({
  id: 'registerExternalAgent',
  description: 'Register a new external agent (A2A or CLI protocol)',
  inputSchema: z.object({
    protocol: z.enum(['cli', 'a2a']),
    name: z.string(),
    description: z.string(),
    identity: z.string().optional(),
    baseUrl: z.string().optional(),
    command: z.string().optional(),
  }),
  execute: async ({ protocol, name, description, identity, baseUrl, command }) => {
    const registered = toolServices.agentRegistry.registerExternalAgent({
      protocol,
      name,
      description,
      identity: identity || description,
      ...(baseUrl ? { baseUrl } : {}),
      ...(command ? { command, args: [] } : {}),
    });
    return { success: registered, name };
  },
});

export const deleteAgentTool = createTool({
  id: 'deleteExternalAgent',
  description: 'Unregister an external agent',
  inputSchema: z.object({ type: z.string() }),
  execute: async ({ type }) => {
    const removed = toolServices.agentRegistry.unregister(type);
    return { success: removed, type };
  },
});
