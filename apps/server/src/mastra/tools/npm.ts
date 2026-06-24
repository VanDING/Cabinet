import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execSync } from 'node:child_process';

export const npmInstallTool = createTool({
  id: 'npmInstall',
  description:
    'Install npm packages using pnpm. Specify package names and whether they are dev dependencies.',
  inputSchema: z.object({
    packages: z.array(z.string()).min(1),
    dev: z.boolean().default(false),
  }),
  execute: async ({ packages, dev }) => {
    const cmd = `pnpm add ${dev ? '-D ' : ''}${packages.join(' ')}`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 120_000, cwd: process.cwd() });
    return { output, command: cmd };
  },
});

export const npmListTool = createTool({
  id: 'npmList',
  description:
    'List installed npm dependencies of the root project. Returns JSON with all packages and versions.',
  inputSchema: z.object({}),
  execute: async () => {
    const output = execSync('pnpm ls -r --depth 0 --json', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      timeout: 30_000,
    });
    return { packages: JSON.parse(output) };
  },
});

export const npmOutdatedTool = createTool({
  id: 'npmOutdated',
  description: 'Check for outdated npm packages in the project.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const output = execSync('pnpm outdated --json', {
        encoding: 'utf-8',
        cwd: process.cwd(),
        timeout: 30_000,
      });
      return { outdated: JSON.parse(output) };
    } catch {
      return { outdated: {}, message: 'All packages up to date or error checking.' };
    }
  },
});
