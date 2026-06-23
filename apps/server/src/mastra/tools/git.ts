import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { execSync } from 'node:child_process';

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf-8', maxBuffer: 1024 * 1024, cwd: '.' }).slice(
      0,
      100_000,
    );
  } catch (err: any) {
    return `Git error: ${err.message ?? err.stderr ?? String(err)}`.slice(0, 500);
  }
}

export const gitStatusTool = createTool({
  id: 'gitStatus',
  description: 'Show working tree status',
  inputSchema: z.object({}),
  execute: async () => ({ output: git('status --porcelain') }),
});

export const gitDiffTool = createTool({
  id: 'gitDiff',
  description: 'Show changes in working tree',
  inputSchema: z.object({ path: z.string().optional().default('.') }),
  execute: async ({ path }) => ({ output: git(`diff "${path}"`) }),
});

export const gitDiffStagedTool = createTool({
  id: 'gitDiffStaged',
  description: 'Show staged changes',
  inputSchema: z.object({}),
  execute: async () => ({ output: git('diff --staged') }),
});

export const gitLogTool = createTool({
  id: 'gitLog',
  description: 'Show commit log',
  inputSchema: z.object({ count: z.number().optional().default(20) }),
  execute: async ({ count }) => ({ output: git(`log --oneline -${count}`) }),
});

export const gitShowTool = createTool({
  id: 'gitShow',
  description: 'Show a specific commit',
  inputSchema: z.object({ commit: z.string().default('HEAD') }),
  execute: async ({ commit }) => ({ output: git(`show "${commit}"`) }),
});

export const gitBranchTool = createTool({
  id: 'gitBranch',
  description: 'List branches',
  inputSchema: z.object({}),
  execute: async () => ({ output: git('branch --list') }),
});

export const gitBlameTool = createTool({
  id: 'gitBlame',
  description: 'Show file blame',
  inputSchema: z.object({ file: z.string() }),
  execute: async ({ file }) => ({ output: git(`blame "${file}"`) }),
});

export const gitCheckoutBranchTool = createTool({
  id: 'gitCheckoutBranch',
  description: 'Switch or create a branch',
  inputSchema: z.object({ name: z.string(), createNew: z.boolean().optional().default(false) }),
  execute: async ({ name, createNew }) => ({
    output: git(`checkout ${createNew ? '-b' : ''} "${name}"`),
  }),
});
