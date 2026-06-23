import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { lintStep } from './shared/lint-step.js';

const analyzeStep = createStep({
  id: 'analyze',
  inputSchema: z.object({ lintErrors: z.array(z.string()), filePath: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async ({ inputData }) => {
    return { summary: `${inputData.filePath}: ${inputData.lintErrors.length} issues found` };
  },
});

export const parallelWorkflow = createWorkflow({
  id: 'parallel-example',
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
})
  .then(lintStep)
  .then(analyzeStep)
  .commit();
