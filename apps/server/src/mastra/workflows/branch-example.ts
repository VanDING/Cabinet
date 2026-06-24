import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const detectLangStep = createStep({
  id: 'detect-lang',
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ language: z.string(), filePath: z.string() }),
  execute: async ({ inputData }) => {
    const ext = inputData.filePath.split('.').pop()?.toLowerCase() ?? '';
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      py: 'python',
      rs: 'rust',
      go: 'go',
    };
    return { language: langMap[ext] ?? 'unknown', filePath: inputData.filePath };
  },
});

const tsFormatter = createStep({
  id: 'ts-format',
  inputSchema: z.object({ language: z.string(), filePath: z.string() }),
  outputSchema: z.object({ formatted: z.boolean(), formatter: z.string() }),
  execute: async () => ({ formatted: true, formatter: 'prettier' }),
});

const pyFormatter = createStep({
  id: 'py-format',
  inputSchema: z.object({ language: z.string(), filePath: z.string() }),
  outputSchema: z.object({ formatted: z.boolean(), formatter: z.string() }),
  execute: async () => ({ formatted: true, formatter: 'black' }),
});

const defaultFormatter = createStep({
  id: 'default-format',
  inputSchema: z.object({ language: z.string(), filePath: z.string() }),
  outputSchema: z.object({ formatted: z.boolean(), formatter: z.string() }),
  execute: async () => ({ formatted: false, formatter: 'none' }),
});

export const branchWorkflow = createWorkflow({
  id: 'branch-example',
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ formatted: z.boolean(), formatter: z.string() }),
})
  .then(detectLangStep)
  .branch([
    [(p) => Promise.resolve(p.inputData.language === 'typescript'), tsFormatter],
    [(p) => Promise.resolve(p.inputData.language === 'python'), pyFormatter],
    [() => Promise.resolve(true), defaultFormatter],
  ])
  .commit();
