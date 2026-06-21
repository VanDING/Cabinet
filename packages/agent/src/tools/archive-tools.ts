import type { ToolDefinition } from '../tool-executor.js';

export interface ArchiveToolDeps {
  listZip: (path: string) => Promise<{ name: string; size: number; isDirectory: boolean }[]>;
  extractZip: (
    path: string,
    targetDir: string,
    entries?: string[],
  ) => Promise<{ extracted: string[] }>;
}

export function createArchiveTools(deps: ArchiveToolDeps): ToolDefinition[] {
  return [
    {
      name: 'read_zip',
      description:
        'List the contents of a ZIP archive without extracting it. Returns file names, sizes, and directory flags.',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the ZIP file' },
        },
        required: ['path'],
      },
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        if (!filePath) return { error: 'path is required' };
        try {
          const entries = await deps.listZip(filePath);
          return {
            path: filePath,
            entries,
            count: entries.length,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'extract_zip',
      description:
        'Extract files from a ZIP archive to a target directory. Optionally extract only specific entries.',
      timeoutMs: 60000,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the ZIP file' },
          target_dir: {
            type: 'string',
            description: 'Directory to extract files into',
          },
          entries: {
            type: 'array',
            description: 'Optional list of specific entry names to extract (default: all entries)',
            items: { type: 'string' },
          },
        },
        required: ['path', 'target_dir'],
      },
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const targetDir = args.target_dir as string;
        const entries = args.entries as string[] | undefined;
        if (!filePath) return { error: 'path is required' };
        if (!targetDir) return { error: 'target_dir is required' };
        try {
          const result = await deps.extractZip(filePath, targetDir, entries);
          return {
            path: filePath,
            target_dir: targetDir,
            extracted: result.extracted,
            count: result.extracted.length,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
