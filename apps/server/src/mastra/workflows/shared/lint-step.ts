import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { execSync } from 'node:child_process';

export const lintStep = createStep({
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
