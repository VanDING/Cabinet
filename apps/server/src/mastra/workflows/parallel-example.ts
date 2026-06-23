import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { execSync } from 'node:child_process';

const lintStep = createStep({
  id: 'lint',
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ lintErrors: z.array(z.string()), filePath: z.string() }),
  execute: async ({ inputData }) => {
    try {
      const out = execSync(
        `npx eslint "${inputData.filePath}" --format=compact 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 1024 * 1024 },
      );
      const errors = out.split('\n').filter((l) => l.includes('Error') || l.includes('Warning'));
      return { lintErrors: errors.slice(0, 20), filePath: inputData.filePath };
    } catch {
      return { lintErrors: [], filePath: inputData.filePath };
    }
  },
});

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
