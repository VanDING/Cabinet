import { z } from 'zod';

export const analystOutputSchema = z.object({
  findings: z.array(
    z.object({
      category: z.string(),
      detail: z.string(),
      severity: z.enum(['info', 'warning', 'critical']),
    }),
  ),
  recommendation: z.string(),
  codeReferences: z.array(z.string()).optional(),
});

export const writerOutputSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      content: z.string(),
    }),
  ),
  summary: z.string(),
});

export const secretaryOutputSchema = z.object({
  response: z.string(),
  actions: z
    .array(
      z.object({
        type: z.enum(['delegated', 'tool_called', 'decided', 'info']),
        summary: z.string(),
      }),
    )
    .optional(),
});
