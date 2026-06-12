import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  stat,
  unlink,
  rmdir,
  rename,
  copyFile as fsCopyFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, extname, resolve } from 'node:path';
import type { CapabilitiesContext } from './types.js';
import {
  readTextFile,
  resolveSafePath,
  MIME_MAP,
  isTextFile,
  globToRegex,
  safeRegex,
} from './helpers.js';

export function createFileCapabilities(
  _ctx: CapabilitiesContext,
  onFileAccess?: (
    path: string,
    operation: 'read' | 'write' | 'edit' | 'delete' | 'move' | 'copy',
  ) => void,
) {
  return {
    readFile: async (filePath: string, offset?: number, limit?: number) => {
      const safePath = await resolveSafePath(filePath);
      onFileAccess?.(safePath, 'read');
      const ext = extname(filePath).toLowerCase();
      const mimeType = MIME_MAP[ext] ?? null;
      const isText = isTextFile(ext);

      if (isText) {
        const content = await readTextFile(safePath);
        const size = Buffer.byteLength(content, 'utf-8');
        if (size > 50 * 1024 * 1024) throw new Error('Text file exceeds 50MB limit');
        if (offset !== undefined || limit !== undefined) {
          const lines = content.split('\n');
          const start = offset ?? 0;
          const end = limit ? start + limit : lines.length;
          return {
            content: lines.slice(start, end).join('\n'),
            size,
            encoding: 'utf-8' as const,
            mimeType: mimeType ?? undefined,
          };
        }
        return { content, size, encoding: 'utf-8' as const, mimeType: mimeType ?? undefined };
      }

      const buf = await readFile(safePath);
      if (buf.length > 50 * 1024 * 1024) throw new Error('Binary file exceeds 50MB limit');
      const base64 = buf.toString('base64');
      return {
        content: base64,
        size: buf.length,
        encoding: 'base64' as const,
        mimeType: mimeType ?? 'application/octet-stream',
      };
    },

    writeFile: async (filePath: string, content: string, overwrite?: boolean) => {
      const safePath = await resolveSafePath(filePath);
      onFileAccess?.(safePath, 'write');
      if (content.length > 50 * 1024 * 1024) throw new Error('Content exceeds 50MB limit');
      if (overwrite === false && existsSync(safePath)) {
        return { written: false, skipped: true };
      }
      await mkdir(dirname(safePath), { recursive: true });
      await writeFile(safePath, content, 'utf-8');
      return { written: true, skipped: false };
    },

    editFile: async (
      filePath: string,
      oldString: string,
      newString: string,
      replaceAll?: boolean,
    ) => {
      const safePath = await resolveSafePath(filePath);
      onFileAccess?.(safePath, 'edit');
      const content = await readTextFile(safePath);
      if (!content.includes(oldString)) return { changed: false, occurrences: 0 };
      if (replaceAll) {
        const parts = content.split(oldString);
        const occurrences = parts.length - 1;
        await writeFile(safePath, parts.join(newString), 'utf-8');
        return { changed: true, occurrences };
      }
      await writeFile(safePath, content.replace(oldString, newString), 'utf-8');
      return { changed: true, occurrences: 1 };
    },

    applyPatch: async (filePath: string, diff: string) => {
      const safePath = await resolveSafePath(filePath);
      const content = await readTextFile(safePath);
      const lines = content.split('\n');
      const diffLines = diff.split('\n');
      let hunksApplied = 0;
      let hunksFailed = 0;
      let i = 0;
      while (i < diffLines.length) {
        const line = diffLines[i];
        if (
          !line ||
          line.startsWith('diff ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('index ')
        ) {
          i++;
          continue;
        }
        const hunkMatch = line!.match(/^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
        if (hunkMatch) {
          const oldStart = parseInt(hunkMatch[1]!, 10) - 1;
          i++;
          const hunkLines: { type: 'context' | 'add' | 'remove'; content: string }[] = [];
          while (
            i < diffLines.length &&
            !diffLines[i]!.startsWith('@@') &&
            !diffLines[i]!.startsWith('diff ')
          ) {
            const hl = diffLines[i]!;
            if (hl.startsWith('+')) hunkLines.push({ type: 'add', content: hl.slice(1) });
            else if (hl.startsWith('-')) hunkLines.push({ type: 'remove', content: hl.slice(1) });
            else if (hl.startsWith(' ')) hunkLines.push({ type: 'context', content: hl.slice(1) });
            i++;
          }
          let srcIdx = oldStart;
          let mismatch = false;
          const result: string[] = [];
          for (const hl of hunkLines) {
            if (hl.type === 'context') {
              if (srcIdx < lines.length && lines[srcIdx] !== hl.content) {
                mismatch = true;
                break;
              }
              result.push(lines[srcIdx]!);
              srcIdx++;
            } else if (hl.type === 'remove') {
              if (srcIdx < lines.length && lines[srcIdx] !== hl.content) {
                mismatch = true;
                break;
              }
              srcIdx++;
            } else if (hl.type === 'add') {
              result.push(hl.content);
            }
          }
          if (mismatch) {
            hunksFailed++;
          } else {
            const before = lines.slice(0, oldStart);
            const after = lines.slice(srcIdx);
            const newLines = [...before, ...result, ...after];
            lines.length = 0;
            lines.push(...newLines);
            hunksApplied++;
          }
        } else {
          i++;
        }
      }
      if (hunksApplied > 0) {
        await writeFile(safePath, lines.join('\n'), 'utf-8');
        return { applied: true, hunksApplied, hunksFailed };
      }
      return { applied: false, hunksApplied, hunksFailed };
    },

    listDirectory: async (dirPath: string) => {
      const safePath = await resolveSafePath(dirPath);
      const root = process.cwd();
      const entries = await readdir(safePath, { withFileTypes: true });
      return entries
        .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
        .map((e) => ({
          name: e.name,
          path: relative(root, join(safePath, e.name)).replace(/\\/g, '/'),
          isDir: e.isDirectory(),
        }));
    },

    searchFiles: async (pattern: string, dir?: string, maxDepth?: number) => {
      const root = resolve(process.cwd());
      const searchRoot = dir ? await resolveSafePath(dir) : root;
      const results: string[] = [];
      const regex = globToRegex(pattern);
      const depthLimit = maxDepth ?? Infinity;
      async function walk(currentDir: string, depth: number) {
        if (depth > depthLimit) return;
        let entries;
        try {
          entries = await readdir(currentDir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
            continue;
          const entryPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(entryPath, depth + 1);
          } else if (regex.test(relative(root, entryPath).replace(/\\/g, '/'))) {
            results.push(relative(root, entryPath).replace(/\\/g, '/'));
          }
        }
      }
      await walk(searchRoot, 0);
      return results.slice(0, 200);
    },

    searchContent: async (pattern: string, dir?: string, include?: string, maxDepth?: number) => {
      const root = resolve(process.cwd());
      const searchRoot = dir ? await resolveSafePath(dir) : root;
      const results: { file: string; line: number; content: string }[] = [];
      const regex = safeRegex(pattern);
      const includeRegex = include ? globToRegex(include) : null;
      const depthLimit = maxDepth ?? Infinity;
      async function walk(currentDir: string, depth: number) {
        if (depth > depthLimit || results.length >= 100) return;
        let entries;
        try {
          entries = await readdir(currentDir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist')
            continue;
          const entryPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(entryPath, depth + 1);
          } else {
            const relPath = relative(root, entryPath).replace(/\\/g, '/');
            if (includeRegex && !includeRegex.test(relPath)) continue;
            try {
              const content = await readTextFile(entryPath);
              const lines = content.split('\n');
              for (let i = 0; i < lines.length && results.length < 100; i++) {
                const line = lines[i];
                if (line !== undefined && regex.test(line)) {
                  results.push({ file: relPath, line: i + 1, content: line.slice(0, 200) });
                }
              }
            } catch {
              /* skip unreadable files */
            }
          }
        }
      }
      await walk(searchRoot, 0);
      return results;
    },

    recentFiles: async () => [],
    watchFile: async () => ({ changed: false, size: 0 }),
    indexProject: async () => ({ indexed: 0, skipped: 0, errors: 1 }),
    deleteFile: async (filePath: string) => {
      const safePath = await resolveSafePath(filePath);
      onFileAccess?.(safePath, 'delete');
      const s = await stat(safePath);
      if (s.isDirectory()) {
        await rmdir(safePath);
      } else {
        await unlink(safePath);
      }
    },

    moveFile: async (source: string, destination: string) => {
      const safeSrc = await resolveSafePath(source);
      const safeDest = await resolveSafePath(destination);
      onFileAccess?.(safeDest, 'move');
      await mkdir(dirname(safeDest), { recursive: true });
      await rename(safeSrc, safeDest);
    },

    copyFile: async (source: string, destination: string) => {
      const safeSrc = await resolveSafePath(source);
      const safeDest = await resolveSafePath(destination);
      onFileAccess?.(safeDest, 'copy');
      await mkdir(dirname(safeDest), { recursive: true });
      await fsCopyFile(safeSrc, safeDest);
    },

    makeDirectory: async (dirPath: string) => {
      const safePath = await resolveSafePath(dirPath);
      await mkdir(safePath, { recursive: true });
    },

    fileInfo: async (filePath: string) => {
      const safePath = await resolveSafePath(filePath);
      const s = await stat(safePath);
      return {
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
        createdAt: s.birthtime.toISOString(),
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
      };
    },
  };
}
