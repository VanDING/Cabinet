import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { toolServices } from './tool-context.js';
import { randomUUID } from 'node:crypto';

export const getDecisionTool = createTool({
  id: 'getDecision',
  description: 'Get a single decision by ID',
  inputSchema: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const decision = toolServices.decision.getById(id);
    return { decision };
  },
});

export const createDecisionTool = createTool({
  id: 'createDecision',
  description: 'Create a new decision through the L0-L3 decision framework',
  inputSchema: z.object({
    title: z.string(),
    description: z.string(),
    options: z.array(z.object({ id: z.string(), label: z.string(), impact: z.string() })),
    projectId: z.string(),
    type: z.string(),
  }),
  execute: async ({ title, description, options, projectId, type }) => {
    const decision = toolServices.decision.create({
      id: randomUUID(),
      projectId,
      type: type as any,
      title,
      description,
      options,
      classification: {
        scopeDescription: description,
        isCrossSession: false,
        optionCount: options.length,
        estimatedCost: 0,
        involvesFunds: false,
        involvesPermissions: false,
        involvesDataDeletion: false,
        involvesOrgConfig: false,
      },
    });
    return { decision };
  },
});

export const approveDecisionTool = createTool({
  id: 'approveDecision',
  description: 'Approve a pending decision',
  inputSchema: z.object({ id: z.string(), captainId: z.string(), chosenOptionId: z.string() }),
  execute: async ({ id, captainId, chosenOptionId }) => {
    const decision = toolServices.decision.approve(id, captainId, chosenOptionId);
    return { decision };
  },
});

export const rejectDecisionTool = createTool({
  id: 'rejectDecision',
  description: 'Reject a pending decision',
  inputSchema: z.object({ id: z.string(), captainId: z.string() }),
  execute: async ({ id, captainId }) => {
    const decision = toolServices.decision.reject(id, captainId);
    return { decision };
  },
});
