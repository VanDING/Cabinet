import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { lintStep } from './shared/lint-step.js';

const testStep = createStep({
  id: 'test',
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ testResults: z.string() }),
  execute: async ({ inputData }) => {
    return { testResults: `${inputData.filePath}: all tests passed` };
  },
});

const reportStep = createStep({
  id: 'report',
  inputSchema: z.object({
    lint: z.object({ lintErrors: z.array(z.string()), success: z.boolean(), filePath: z.string() }),
    test: z.object({ testResults: z.string() }),
  }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async ({ inputData }) => {
    const lintSummary = inputData.lint.success
      ? 'lint passed'
      : `${inputData.lint.lintErrors.length} lint issues`;
    return {
      summary: `${inputData.lint.filePath}: ${lintSummary}, ${inputData.test.testResults}`,
    };
  },
});

export const parallelWorkflow = createWorkflow({
  id: 'parallel-example',
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
})
  .parallel([lintStep, testStep])
  .then(reportStep)
  .commit();
