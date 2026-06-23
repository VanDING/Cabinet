import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';

const readStep = createStep({
  id: 'read-file',
  inputSchema: z.object({ path: z.string() }),
  outputSchema: z.object({ content: z.string(), fileName: z.string() }),
  execute: async ({ inputData }) => {
    const content = await readFile(inputData.path, 'utf-8');
    const fileName = inputData.path.split(/[/\\]/).pop() ?? 'unknown';
    return { content, fileName };
  },
});

const analyzeStep = createStep({
  id: 'analyze',
  inputSchema: z.object({ content: z.string(), fileName: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async ({ inputData }) => {
    const lines = inputData.content.split('\n').length;
    const chars = inputData.content.length;
    return { summary: `${inputData.fileName}: ${lines} lines, ${chars} characters` };
  },
});

export const processFilesWorkflow = createWorkflow({
  id: 'process-files',
  inputSchema: z.object({ path: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
})
  .then(readStep)
  .then(analyzeStep)
  .commit();
