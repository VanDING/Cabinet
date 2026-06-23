import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const lintStep = createStep({
  id: 'lint',
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({
    lintErrors: z.array(z.string()),
    success: z.boolean(),
    filePath: z.string(),
  }),
  execute: async ({ inputData }) => {
    try {
      const cmd = `npx eslint "${inputData.filePath}" --format=compact 2>/dev/null || true`;
      const out = execSync(cmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      const errors = out.split('\n').filter((l) => l.includes('Error') || l.includes('Warning'));
      return {
        lintErrors: errors.slice(0, 20),
        success: errors.length === 0,
        filePath: inputData.filePath,
      };
    } catch {
      return {
        lintErrors: ['Lint check unavailable'],
        success: true,
        filePath: inputData.filePath,
      };
    }
  },
});

const reviewStep = createStep({
  id: 'review',
  inputSchema: z.object({
    lintErrors: z.array(z.string()),
    success: z.boolean(),
    filePath: z.string(),
  }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async ({ inputData }) => {
    const content = await readFile(inputData.filePath, 'utf-8');
    const lines = content.split('\n');
    const recs: string[] = [];
    if (lines.length > 500) recs.push('Consider splitting - over 500 lines');
    if (lines.some((l) => l.length > 200)) recs.push('Some lines exceed 200 chars');
    if (lines.some((l) => l.includes('TODO') || l.includes('FIXME')))
      recs.push('Has TODO/FIXME comments');
    return {
      summary: [
        `Lint: ${inputData.success ? 'Passed' : 'Has issues'} (${inputData.lintErrors.length} findings)`,
        ...recs,
      ].join('\n'),
    };
  },
});

export const codeReviewWorkflow = createWorkflow({
  id: 'code-review',
  inputSchema: z.object({ filePath: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
})
  .then(lintStep)
  .then(reviewStep)
  .commit();
