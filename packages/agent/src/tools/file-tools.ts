import type { ToolDefinition } from '../tool-executor.js';

export interface FileToolDeps {
  readFile: (
    path: string,
    offset?: number,
    limit?: number,
  ) => Promise<{ content: string; size: number; encoding: 'utf-8' | 'base64'; mimeType?: string }>;
  writeFile: (
    path: string,
    content: string,
    overwrite?: boolean,
  ) => Promise<{ written: boolean; skipped: boolean }>;
  editFile: (
    path: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ) => Promise<{ changed: boolean; occurrences: number }>;
  applyPatch: (
    path: string,
    diff: string,
  ) => Promise<{ applied: boolean; hunksApplied: number; hunksFailed: number }>;
  moveFile: (source: string, destination: string) => Promise<void>;
  copyFile: (source: string, destination: string) => Promise<void>;
  makeDirectory: (path: string) => Promise<void>;
  fileInfo: (path: string) => Promise<{
    size: number;
    modifiedAt: string;
    createdAt: string;
    isDirectory: boolean;
    isFile: boolean;
  }>;
  listDirectory: (path: string) => Promise<{ name: string; path: string; isDir: boolean }[]>;
  searchFiles: (pattern: string, dir?: string, maxDepth?: number) => Promise<string[]>;
  searchContent: (
    pattern: string,
    dir?: string,
    include?: string,
    maxDepth?: number,
  ) => Promise<{ file: string; line: number; content: string }[]>;
  deleteFile: (path: string) => Promise<void>;
  recentFiles: (
    limit?: number,
  ) => Promise<{ path: string; operation: string; timestamp: string }[]>;
  watchFile: (path: string, timeoutMs?: number) => Promise<{ changed: boolean; size: number }>;
  indexProject: (
    projectId: string,
    rootPath: string,
    force?: boolean,
  ) => Promise<{ indexed: number; skipped: number; errors: number }>;
}

export function createFileTools(deps: FileToolDeps): ToolDefinition[] {
  return [
    {
      name: 'read_file',
      timeoutMs: 30000,
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
      description:
        'Create a new file or overwrite an existing one. Set overwrite: false to prevent accidental overwrites.',
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const content = args.content as string;
        const overwrite = args.overwrite !== false; // default true for backward compat
        if (!filePath) return { error: 'path is required' };
        if (content === undefined || content === null) return { error: 'content is required' };
        try {
          const result = await deps.writeFile(filePath, content, overwrite);
          if (result.skipped) {
            return {
              skipped: true,
              path: filePath,
              reason: 'File exists and overwrite is disabled',
            };
          }
          return { written: result.written, path: filePath, size: content.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'edit_file',
      description:
        'Replace old_string with new_string in a file. Use replace_all: true to replace all occurrences.',
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const oldString = args.old_string as string;
        const newString = args.new_string as string;
        const replaceAll = args.replace_all === true;
        if (!filePath) return { error: 'path is required' };
        if (oldString === undefined || oldString === null)
          return { error: 'old_string is required' };
        if (newString === undefined || newString === null)
          return { error: 'new_string is required' };
        try {
          const result = await deps.editFile(filePath, oldString, newString, replaceAll);
          return { edited: result.changed, path: filePath, occurrences: result.occurrences };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'apply_patch',
      description:
        'Apply a unified diff patch to a file. The diff header (--- a/path, +++ b/path) identifies the target file.',
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const diff = args.diff as string;
        if (!filePath) return { error: 'path is required' };
        if (!diff) return { error: 'diff is required' };
        try {
          const result = await deps.applyPatch(filePath, diff);
          return {
            applied: result.applied,
            path: filePath,
            hunksApplied: result.hunksApplied,
            hunksFailed: result.hunksFailed,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'move_file',
      execute: async (args: Record<string, unknown>) => {
        const source = args.source as string;
        const destination = args.destination as string;
        if (!source) return { error: 'source is required' };
        if (!destination) return { error: 'destination is required' };
        try {
          await deps.moveFile(source, destination);
          return { moved: true, source, destination };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'copy_file',
      execute: async (args: Record<string, unknown>) => {
        const source = args.source as string;
        const destination = args.destination as string;
        if (!source) return { error: 'source is required' };
        if (!destination) return { error: 'destination is required' };
        try {
          await deps.copyFile(source, destination);
          return { copied: true, source, destination };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'make_directory',
      execute: async (args: Record<string, unknown>) => {
        const dirPath = args.path as string;
        if (!dirPath) return { error: 'path is required' };
        try {
          await deps.makeDirectory(dirPath);
          return { created: true, path: dirPath };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'file_info',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        if (!filePath) return { error: 'path is required' };
        try {
          const info = await deps.fileInfo(filePath);
          return info;
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'list_directory',
      timeoutMs: 30000,
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
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const pattern = args.pattern as string;
        if (!pattern) return { error: 'pattern is required' };
        const dir = args.path as string | undefined;
        const maxDepth = args.max_depth as number | undefined;
        try {
          const matches = await deps.searchFiles(pattern, dir, maxDepth);
          return { pattern, matches, count: matches.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'grep',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const pattern = args.pattern as string;
        if (!pattern) return { error: 'pattern is required' };
        const dir = args.path as string | undefined;
        const include = args.include as string | undefined;
        const maxDepth = args.max_depth as number | undefined;
        try {
          const matches = await deps.searchContent(pattern, dir, include, maxDepth);
          return { pattern, matches, count: matches.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'recent_files',
      description:
        'List recently accessed files in the current workspace. Useful for understanding what files are being worked on.',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const limit = (args.limit as number) ?? 20;
        try {
          const files = await deps.recentFiles(limit);
          return { files, count: files.length };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'watch_file',
      description:
        'Watch a file for changes. Returns when the file is modified or the timeout is reached. Useful after running build commands to wait for output files.',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const filePath = args.path as string;
        const timeoutMs = (args.timeout_ms as number) ?? 30000;
        if (!filePath) return { error: 'path is required' };
        try {
          const result = await deps.watchFile(filePath, timeoutMs);
          return { changed: result.changed, path: filePath, size: result.size };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'index_project',
      description:
        'Scan and index all source files in a project directory for semantic search. Call this after attaching a project for the first time, or use force: true to re-index.',
      execute: async (args: Record<string, unknown>) => {
        const projectId = args.project_id as string;
        const rootPath = args.root_path as string;
        const force = args.force === true;
        if (!projectId) return { error: 'project_id is required' };
        if (!rootPath) return { error: 'root_path is required' };
        try {
          const result = await deps.indexProject(projectId, rootPath, force);
          return result;
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
