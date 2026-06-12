import { z } from 'zod';

export const fileSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.string().optional(),
  })
  .passthrough();

export const chatSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  captainId: z.string().optional(),
  projectId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  files: z.array(fileSchema).optional(),
  stream: z.boolean().optional(),
  dispatchMode: z.enum(['single', 'pipeline', 'parallel']).optional(),
  thinkingBudget: z.number().min(1024).max(128000).nullable().optional(),
  targetAgent: z.string().optional(),
  type: z.enum(['chat', 'skill_invoke']).optional().default('chat'),
  skillName: z.string().optional(),
  skillArgs: z.string().optional(),
  interactive: z.boolean().optional(),
});

export type ChatBody = z.infer<typeof chatSchema>;
