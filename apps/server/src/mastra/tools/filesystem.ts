import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

export const readFileTool = createTool({
  id: 'read-file',
  description: 'Read a file from the local filesystem',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file'),
  }),
  execute: async ({ path }) => {
    const content = await readFile(path, 'utf-8');
    return { content };
  },
});

export const writeFileTool = createTool({
  id: 'write-file',
  description: 'Write content to a file',
  inputSchema: z.object({
    path: z.string().describe('Absolute path to the file'),
    content: z.string().describe('Content to write'),
  }),
  execute: async ({ path, content }) => {
    await writeFile(path, content, 'utf-8');
    return { success: true };
  },
});

export const execCommandTool = createTool({
  id: 'exec-command',
  description: 'Execute a shell command',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    workdir: z.string().optional().describe('Working directory'),
  }),
  execute: async ({ command, workdir }) => {
    const output = execSync(command, {
      cwd: workdir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: output };
  },
});
