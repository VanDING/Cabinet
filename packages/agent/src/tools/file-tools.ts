import type { ToolDefinition } from '../tool-executor.js';

export interface FileToolDeps {
  readFile: (path: string, offset?: number, limit?: number) => Promise<{ content: string; size: number; encoding: 'utf-8' | 'base64'; mimeType?: string }>;
  writeFile: (path: string, content: string) => Promise<void>;
  editFile: (path: string, oldString: string, newString: string) => Promise<{ changed: boolean }>;
  listDirectory: (path: string) => Promise<{ name: string; path: string; isDir: boolean }[]>;
  searchFiles: (pattern: string, dir?: string) => Promise<string[]>;
  searchContent: (pattern: string, dir?: string, include?: string) => Promise<{ file: string; line: number; content: string }[]>;
  deleteFile: (path: string) => Promise<void>;
}

export function createFileTools(deps: FileToolDeps): ToolDefinition[] {
  return [
    {
      name: 'read_file',
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        if (!filePath) return { error: 'path is required' };
        const offset = args.offset as number | undefined;
        const limit = args.limit as number | undefined;
        try {
          const result = await deps.readFile(filePath, offset, limit);
          return {
            path: filePath,
            content: result.content,
            size: result.size,
            encoding: result.encoding,
            mimeType: result.mimeType,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'write_file',
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const content = args.content as string;
        if (!filePath) return { error: 'path is required' };
        if (content === undefined || content === null) return { error: 'content is required' };
        try {
          await deps.writeFile(filePath, content);
          return { written: true, path: filePath, size: content.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'edit_file',
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const oldString = args.old_string as string;
        const newString = args.new_string as string;
        if (!filePath) return { error: 'path is required' };
        if (oldString === undefined || oldString === null) return { error: 'old_string is required' };
        if (newString === undefined || newString === null) return { error: 'new_string is required' };
        try {
          const result = await deps.editFile(filePath, oldString, newString);
          return { edited: result.changed, path: filePath };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'list_directory',
      execute: async (args: Record<string, unknown>) => {
        const dirPath = (args.path as string) ?? '.';
        try {
          const entries = await deps.listDirectory(dirPath);
          return { path: dirPath, entries };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'glob',
      execute: async (args: Record<string, unknown>) => {
        const pattern = args.pattern as string;
        if (!pattern) return { error: 'pattern is required' };
        const dir = args.path as string | undefined;
        try {
          const matches = await deps.searchFiles(pattern, dir);
          return { pattern, matches, count: matches.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'grep',
      execute: async (args: Record<string, unknown>) => {
        const pattern = args.pattern as string;
        if (!pattern) return { error: 'pattern is required' };
        const dir = args.path as string | undefined;
        const include = args.include as string | undefined;
        try {
          const matches = await deps.searchContent(pattern, dir, include);
          return { pattern, matches, count: matches.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'delete_file',
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        if (!filePath) return { error: 'path is required' };
        try {
          await deps.deleteFile(filePath);
          return { deleted: true, path: filePath };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
