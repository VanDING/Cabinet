import type { ServerContext } from './context.js';
import { detectDangerousCommand } from './utils/security.js';
import { DocumentChunkRepository, SystemKnowledgeRepository } from '@cabinet/storage';
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
  realpath,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, dirname, extname, resolve, isAbsolute } from 'node:path';
import { exec, spawn } from 'node:child_process';
import { BrowserPool } from '@cabinet/harness';
import { promisify } from 'node:util';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import notifier from 'node-notifier';
import Parser from 'rss-parser';
import nodemailer from 'nodemailer';

const execAsync = promisify(exec);

const RAG_DEFAULT_TOP_K = 5;

async function readTextFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString('utf-8').slice(1);
  }
  const utf8 = buf.toString('utf-8');
  if (utf8.includes('�')) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      /* fall through */
    }
  }
  return utf8;
}

// ── MIME & text detection ──

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.mdx',
  '.json',
  '.xml',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.htm',
  '.vue',
  '.svelte',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.graphql',
  '.proto',
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.csv',
  '.tsv',
  '.log',
  '.lock',
  '.toml',
]);

function isTextFile(ext: string): boolean {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext || ext.length > 10) return true;
  return false;
}

// ── Path safety ──

async function resolveSafePath(filePath: string): Promise<string> {
  const fullPath = resolve(filePath);
  try {
    return await realpath(fullPath);
  } catch {
    // File does not exist — return normalized path without boundary checks
    return fullPath;
  }
}

// ── Glob / regex helpers ──

function globToRegex(pattern: string): RegExp {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  if (pattern.startsWith('*')) re = '.*' + re.slice(2);
  return new RegExp('^' + re + '$');
}

function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  }
}

// ── Network safety ──

function isInternalIP(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  )
    return true;
  if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (
    hostname === '[::1]' ||
    hostname === '[fe80::]' ||
    hostname.startsWith('[fc') ||
    hostname.startsWith('[fd')
  )
    return true;
  return false;
}

function extractTitle(html: string, contentType: string): string | undefined {
  if (!contentType.includes('html')) return undefined;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim().slice(0, 200);
}

// ── Shell safety ──

const SAFE_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'TEMP',
  'TMP',
  'TMPDIR',
  'SHELL',
  'LANG',
  'LC_ALL',
  'TERM',
  'COLORTERM',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'NODE_ENV',
  'NODE_PATH',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'SSH_AUTH_SOCK',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'PNPM_HOME',
  'npm_config_cache',
]);

function buildSafeEnv(): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_ENV_KEYS.has(key) && value !== undefined) {
      safe[key] = value;
    }
  }
  if (!safe.PATH)
    safe.PATH =
      process.platform === 'win32'
        ? 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem'
        : '/usr/local/bin:/usr/bin:/bin';
  if (!safe.HOME) safe.HOME = process.cwd();
  return safe;
}

export function buildEnvironmentSection(projectRootPath?: string): string {
  const workDir = projectRootPath || process.cwd();
  const now = new Date();
  const tzOffset = -now.getTimezoneOffset() / 60;
  const tzLabel = `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`;
  const dateStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const parts = ['## System Environment'];
  parts.push(`- Current date: ${dateStr} (${weekday})`);
  parts.push(`- Current time: ${timeStr} (${tzLabel})`);
  parts.push(`- Platform: ${process.platform} (${process.arch})`);
  if (process.platform === 'win32') {
    parts.push(`- Shell: ${process.env.COMSPEC || 'cmd.exe'}`);
  } else {
    parts.push(`- Shell: ${process.env.SHELL || '/bin/bash'}`);
  }
  parts.push(`- Working Directory: ${workDir}`);
  if (projectRootPath) {
    parts.push(
      `- Note: You are working on a project at the above path. Use it for all file operations.`,
    );
  }
  parts.push(`- Node.js: ${process.version}`);
  parts.push(
    `- If you need information about system capabilities, directories, or agent roles, use the query_system_knowledge tool.`,
  );
  return parts.join('\n');
}

// ── Chunking helpers ──

interface ChunkResult {
  content: string;
  startChar: number;
  endChar: number;
}

function chunkText(text: string, chunkSize = 800, overlap = 100): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  let offset = 0;
  while (offset < text.length) {
    const end = Math.min(offset + chunkSize, text.length);
    chunks.push({ content: text.slice(offset, end), startChar: offset, endChar: end });
    if (end >= text.length) break;
    offset = end - overlap;
  }
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Shared capability implementations ──

export interface CapabilitiesContext {
  db: ServerContext['db'];
  gateway: ServerContext['gateway'];
  logger: ServerContext['logger'];
  taskScheduler: ServerContext['taskScheduler'];
  workflowRepo: ServerContext['workflowRepo'];
  projectRepo: ServerContext['projectRepo'];
}

export function createFileCapabilities(
  _ctx: CapabilitiesContext,
  onFileAccess?: (path: string, operation: 'read' | 'write' | 'edit' | 'delete' | 'move' | 'copy') => void,
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

function extractTextFromHtml(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(new RegExp('</?.[^>]*>', 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

export function createWebCapabilities(_ctx: CapabilitiesContext) {
  return {
    webFetch: async (url: string, maxLength?: number) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0 WebFetcher' },
          redirect: 'follow',
        });
        const contentType = res.headers.get('content-type') ?? 'text/plain';
        const text = await res.text();
        const limit = maxLength ?? 10000;
        // For HTML, extract main text content before truncating
        let content = text;
        if (contentType.includes('html')) {
          content = extractTextFromHtml(text);
        }
        const truncated = content.slice(0, Math.min(limit, 2 * 1024 * 1024));
        const title = extractTitle(text, contentType);
        return { content: truncated, contentType, status: res.status, title };
      } finally {
        clearTimeout(timer);
      }
    },

    httpRequest: async (
      method: string,
      url: string,
      headers?: Record<string, string>,
      body?: string,
    ) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');
      if (body && body.length > 1 * 1024 * 1024) throw new Error('Request body exceeds 1MB limit');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0', ...headers },
          body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
          redirect: 'follow',
        });
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          resHeaders[k] = v;
        });
        const resBody = await res.text();
        return {
          status: res.status,
          headers: resHeaders,
          body: resBody.slice(0, 50 * 1024 * 1024),
        };
      } finally {
        clearTimeout(timer);
      }
    },

    githubApiFetch: async (owner: string, repo: string, path?: string) => {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path ?? ''}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(apiUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Cabinet/2.0',
            Accept: 'application/vnd.github.v3+json',
          },
        });
        if (!res.ok) {
          return { content: '', error: `GitHub API error: ${res.status} ${res.statusText}` };
        }
        const data = await res.json();
        if (Array.isArray(data)) {
          // Directory listing
          const items = data.map((item: any) => ({
            name: item.name,
            path: item.path,
            type: item.type,
          }));
          return {
            content:
              `Directory listing for ${path ?? 'root'}:\n` +
              items.map((i) => `- ${i.type}: ${i.name}`).join('\n'),
            items,
          };
        } else {
          // File content
          if (data.content && data.encoding === 'base64') {
            const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
            return { content: decoded.slice(0, 50000) };
          }
          return { content: JSON.stringify(data, null, 2) };
        }
      } finally {
        clearTimeout(timer);
      }
    },

    cleanWebFetch: async (url: string, maxLength?: number) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0 WebFetcher' },
          redirect: 'follow',
        });
        const contentType = res.headers.get('content-type') ?? 'text/plain';
        const text = await res.text();
        const title = extractTitle(text, contentType);
        const cleaned = extractTextFromHtml(text);
        const limit = maxLength ?? 10000;
        return { content: cleaned.slice(0, limit), title };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Command allowlist & safe execution ──

const ALLOWED_COMMANDS = new Set([
  'git', 'npm', 'npx', 'node', 'python3', 'python',
  'rustc', 'cargo', 'go', 'javac', 'java',
  'docker',
  'ls', 'cat', 'echo', 'mkdir', 'touch', 'cp', 'mv', 'rm',
  'grep', 'find', 'wc', 'head', 'tail', 'sort', 'uniq',
  'chmod', 'chown',
]);

/** Sub-command restrictions for commands that need extra guarding. */
const COMMAND_RESTRICTIONS: Record<string, string[]> = {
  docker: ['ps', 'logs', 'images', 'info', 'version', 'inspect'],
  rm: [], // only rm <file>, no flags like -rf
};

const SHELL_META = /[;&|><$(){}\[\]*?`\n\r]/;

function parseCommand(command: string): string[] | null {
  if (SHELL_META.test(command)) return null;
  return command.trim().split(/\s+/).filter(Boolean);
}

function isAllowedCommand(cmd: string, args: string[]): boolean {
  if (!ALLOWED_COMMANDS.has(cmd)) return false;
  const restrictions = COMMAND_RESTRICTIONS[cmd];
  if (restrictions) {
    // git clone → "clone" must be in restrictions
    const sub = args[0];
    if (sub && !restrictions.includes(sub)) return false;
    // rm with no sub-command restriction: only allow if no flags
    if (restrictions.length === 0 && args.some((a) => a.startsWith('-'))) return false;
  }
  return true;
}

export function createShellCapabilities(_ctx: CapabilitiesContext) {
  return {
    execCommand: async (command: string, cwd?: string, timeout?: number) => {
      // 1. Also run the blacklist as secondary defense
      const blocked = detectDangerousCommand(command);
      if (blocked) throw new Error(`Command blocked for safety: ${blocked}`);

      // 2. Parse into [cmd, ...args], reject shell metacharacters
      const parts = parseCommand(command);
      if (!parts || parts.length === 0) {
        throw new Error(
          'Shell metacharacters not allowed. Use simple command with space-separated arguments.',
        );
      }
      const [cmd, ...args] = parts;

      // 3. Allowlist check
      if (!isAllowedCommand(cmd!, args)) {
        throw new Error(
          `Command '${cmd}' not in allowlist or sub-command restricted. Allowed: ${[...ALLOWED_COMMANDS].join(', ')}`,
        );
      }

      const workDir = cwd ? await resolveSafePath(cwd) : process.cwd();

      return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const child = spawn(cmd!, args, {
          cwd: workDir,
          shell: false,
          env: buildSafeEnv(),
          timeout: timeout ?? 60000,
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
        child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

        child.on('close', (code: number | null) => {
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        });

        child.on('error', (err: Error) => {
          reject(new Error(`Command failed: ${err.message}`));
        });
      });
    },
  };
}

export function createSchedulerCapabilities(ctx: CapabilitiesContext, defaultProjectId?: string) {
  return {
    scheduleTask: async (
      name: string,
      cronExpression: string,
      prompt: string,
      recurring: boolean,
    ) => {
      const id = `wf_${Date.now()}`;
      const def = {
        steps: [{ type: 'llm', title: name, data: { prompt } }],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'exec', type: 'llm', title: name, data: { prompt } },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'exec' },
          { from: 'exec', to: 'end' },
        ],
      };
      const projectId = defaultProjectId ?? (ctx.projectRepo.listAll()[0]?.id ?? 'default');
      ctx.workflowRepo.create(id, projectId, name, JSON.stringify(def), 'draft', recurring ? cronExpression : undefined);
      if (recurring) {
        ctx.taskScheduler.schedule(id, name, cronExpression);
      }
      return { id };
    },
    listScheduledTasks: async () => {
      return ctx.taskScheduler.list();
    },
    cancelScheduledTask: async (id: string) => {
      ctx.taskScheduler.unschedule(id);
      ctx.workflowRepo.updateCron(id, null);
    },
  };
}

export function createKnowledgeCapabilities(ctx: CapabilitiesContext) {
  return {
    indexDocument: async (filePath: string, projectId: string) => {
      const safePath = await resolveSafePath(filePath);
      const content = await readTextFile(safePath);
      if (content.length === 0) throw new Error('File is empty');

      const chunksRepo = new DocumentChunkRepository(ctx.db);
      chunksRepo.deleteByPath(projectId, filePath);

      const chunks = chunkText(content, 800, 100);
      if (chunks.length === 0) throw new Error('No chunks produced');

      let embeddings: number[][] = [];
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({
            texts: chunks.map((c) => c.content),
          });
          embeddings = result.embeddings;
        } catch {
          // Store without embeddings — text search fallback
        }
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        chunksRepo.insert({
          project_id: projectId,
          source_path: filePath,
          chunk_index: i,
          content: chunk.content,
          embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
          metadata: JSON.stringify({ startChar: chunk.startChar, endChar: chunk.endChar }),
        });
      }
      ctx.logger.info('Document indexed', { path: filePath, chunks: chunks.length, projectId });
      return { chunkCount: chunks.length, filePath };
    },

    searchDocuments: async (query: string, projectId: string, limit?: number) => {
      let queryEmbedding: number[] | undefined;
      if (ctx.gateway) {
        try {
          const result = await ctx.gateway.generateEmbeddings({ texts: [query] });
          queryEmbedding = result.embeddings[0];
        } catch {
          /* fall back to text search */
        }
      }

      const chunksRepo = new DocumentChunkRepository(ctx.db);
      const rows = chunksRepo.findByProject(projectId);

      if (rows.length === 0) return { chunks: [] };

      if (queryEmbedding) {
        const scored = rows
          .map((row) => {
            const emb = row.embedding ? (JSON.parse(row.embedding) as number[]) : null;
            const score = emb ? cosineSimilarity(queryEmbedding!, emb) : 0;
            return {
              content: row.content,
              sourcePath: row.source_path,
              chunkIndex: row.chunk_index,
              score,
            };
          })
          .filter((c) => c.score > 0.4)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit ?? RAG_DEFAULT_TOP_K);
        return { chunks: scored };
      }

      const lower = query.toLowerCase();
      const scored = rows
        .filter((row) => row.content.toLowerCase().includes(lower))
        .slice(0, limit ?? RAG_DEFAULT_TOP_K)
        .map((row) => ({
          content: row.content,
          sourcePath: row.source_path,
          chunkIndex: row.chunk_index,
          score: 0.5,
        }));
      return { chunks: scored };
    },

    clearDocumentIndex: async (projectId: string, filePath?: string) => {
      const chunksRepo = new DocumentChunkRepository(ctx.db);
      if (filePath) {
        chunksRepo.deleteByPath(projectId, filePath);
        return { removed: -1 };
      }
      chunksRepo.deleteByProject(projectId);
      return { removed: -1 };
    },
  };
}

export function createEvaluationCapabilities(ctx: CapabilitiesContext) {
  return {
    evaluateOutput: async (content: string, sourceType: string, sourceId?: string) => {
      if (!ctx.gateway) throw new Error('No LLM gateway available for evaluation');

      const evaluatorModel = 'claude-haiku-4-5';
      const prompt = [
        'Evaluate the following AI-generated output across 4 dimensions. Score each 1-10.',
        '',
        'Dimensions:',
        '1. accuracy — factual correctness and absence of errors',
        '2. completeness — covers all necessary aspects, nothing important missing',
        '3. actionability — provides concrete, usable next steps or recommendations',
        '4. clarity — well-structured, easy to understand, appropriate tone',
        '',
        'Output to evaluate:',
        content.slice(0, 4000),
        '',
        'Respond with ONLY a JSON object:',
        '{',
        '  "overallScore": <number 1-10>,',
        '  "dimensions": {',
        '    "accuracy": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "completeness": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "actionability": {"score": <1-10>, "feedback": "<1 sentence>"},',
        '    "clarity": {"score": <1-10>, "feedback": "<1 sentence>"}',
        '  },',
        '  "feedback": "<2-3 sentence overall assessment>"',
        '}',
      ].join('\n');

      try {
        const result = await ctx.gateway.generateText({
          model: evaluatorModel,
          systemPrompt: 'You are an expert quality evaluator. Be precise and constructive.',
          messages: [{ role: 'user', content: prompt }],
        });
        const parsed = JSON.parse(result.content);
        const overallScore = typeof parsed.overallScore === 'number' ? parsed.overallScore : 5;
        const dimensions = parsed.dimensions ?? {};

        const id = `eval_${Date.now()}`;
        ctx.db
          .prepare(
            `INSERT INTO evaluation_results (id, project_id, session_id, source_type, source_id, overall_score, dimensions, feedback, evaluator_model)
           VALUES (?, 'default', NULL, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            sourceType,
            sourceId ?? null,
            overallScore,
            JSON.stringify(dimensions),
            parsed.feedback ?? '',
            evaluatorModel,
          );

        return { overallScore, dimensions, feedback: parsed.feedback ?? '', evaluatorModel };
      } catch {
        return {
          overallScore: 5,
          dimensions: {},
          feedback: 'Evaluation failed — model output unparseable',
          evaluatorModel,
        };
      }
    },
  };
}

export function createSystemKnowledgeCapabilities(ctx: CapabilitiesContext) {
  const repo = new SystemKnowledgeRepository(ctx.db);
  return {
    querySystemKnowledge: async (query: string, limit?: number) => {
      return repo.search(query, limit ?? 5);
    },
    getSystemKnowledge: async (topic: string) => {
      return repo.findByTopic(topic) ?? null;
    },
  };
}

export function createLSPCapabilities() {
  return {
    workspaceSymbols: async () => ({
      available: false as const,
      error: 'LSP not available in capabilities mode',
    }),
    goToDefinition: async () => ({
      available: false as const,
      error: 'LSP not available in capabilities mode',
    }),
    findReferences: async () => ({
      available: false as const,
      error: 'LSP not available in capabilities mode',
    }),
    diagnostics: async () => ({
      available: false as const,
      error: 'LSP not available in capabilities mode',
    }),
  };
}

// ── Document Capabilities ────────────────────────────────────

export function createDocumentCapabilities() {
  return {
    readPdf: async (path: string) => {
      const buffer = await readFile(path);
      // Dynamic import to avoid loading pdfjs-dist in test environments
      const pdfParse = await import('pdf-parse').then((m) => (m as any).default ?? m);
      const data = await pdfParse(buffer);
      return { text: data.text, pages: data.numpages, info: data.info };
    },
    readDocx: async (path: string) => {
      const result = await mammoth.extractRawText({ path });
      return { text: result.value, styles: [] };
    },
    readXlsx: async (path: string, sheetName?: string) => {
      const workbook = XLSX.readFile(path);
      const sheet = sheetName || workbook.SheetNames[0]!;
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]!, { header: 1 }) as unknown[][];
      return { sheets: workbook.SheetNames, data };
    },
    readPptx: async (path: string) => {
      const zip = new AdmZip(path);
      const entries = zip.getEntries();
      const slideEntries = entries
        .filter(
          (e) => e.entryName.startsWith('ppt/slides/slide') && e.entryName.endsWith('.xml'),
        )
        .sort((a, b) => a.entryName.localeCompare(b.entryName));

      const slides: { text: string; notes: string }[] = [];
      for (const entry of slideEntries) {
        const xml = zip.readAsText(entry);
        const texts: string[] = [];
        const textMatches = xml.matchAll(/<a:t>([^<]*)<\/a:t>/g);
        for (const match of textMatches) {
          if (match[1]) texts.push(match[1]);
        }
        slides.push({ text: texts.join(' ').trim(), notes: '' });
      }
      return { slides };
    },
  };
}

// ── Archive Capabilities ─────────────────────────────────────

export function createArchiveCapabilities() {
  return {
    listZip: async (path: string) => {
      const zip = new AdmZip(path);
      return zip.getEntries().map((e) => ({
        name: e.entryName,
        size: e.header.size,
        isDirectory: e.isDirectory,
      }));
    },
    extractZip: async (path: string, targetDir: string, entries?: string[]) => {
      const zip = new AdmZip(path);
      zip.extractAllTo(targetDir, true);
      return { extracted: entries ?? zip.getEntries().map((e) => e.entryName) };
    },
  };
}

// ── Browser Capabilities ───────────────────────────────────────

let sharedBrowserPool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!sharedBrowserPool) {
    sharedBrowserPool = new BrowserPool({ maxContexts: 3 });
  }
  return sharedBrowserPool;
}

export function createBrowserCapabilities() {
  const pool = getBrowserPool();
  return {
    browserNavigate: async (sessionId: string, url: string, waitFor?: string) => {
      await pool.initialize();
      return pool.navigate(sessionId, url, { waitFor });
    },
    browserClick: async (sessionId: string, selector: string) => {
      return { clicked: await pool.click(sessionId, selector) };
    },
    browserType: async (sessionId: string, selector: string, text: string, submit?: boolean) => {
      return { typed: await pool.type(sessionId, selector, text, submit) };
    },
    browserRead: async (sessionId: string, selector?: string) => {
      return pool.read(sessionId, selector);
    },
    browserScreenshot: async (sessionId: string, selector?: string) => {
      return pool.screenshot(sessionId, selector);
    },
    browserEvaluate: async (sessionId: string, script: string) => {
      return { result: await pool.evaluate(sessionId, script) };
    },
  };
}

// ── Communication Capabilities ───────────────────────────────

export function createCommunicationCapabilities() {
  const rssParser = new Parser();
  return {
    fetchRss: async (url: string, limit?: number) => {
      const feed = await rssParser.parseURL(url);
      return {
        entries: (feed.items ?? []).slice(0, limit ?? 20).map((item: any) => ({
          title: item.title ?? '',
          link: item.link ?? '',
          pubDate: item.pubDate ?? item.isoDate,
          content: item.content ?? item.contentSnippet ?? '',
        })),
      };
    },
    sendEmail: async (
      to: string,
      subject: string,
      body: string,
      bodyType?: 'text' | 'html',
    ) => {
      // SMTP config is read from environment or settings at runtime
      const smtpConfig = process.env.SMTP_CONFIG
        ? JSON.parse(process.env.SMTP_CONFIG)
        : null;
      if (!smtpConfig) {
        throw new Error(
          'SMTP not configured. Set SMTP_CONFIG env var with JSON transport config.',
        );
      }
      const transporter = nodemailer.createTransport(smtpConfig);
      const result = await transporter.sendMail({
        from: smtpConfig.from,
        to,
        subject,
        [bodyType === 'html' ? 'html' : 'text']: body,
      });
      return { sent: true, messageId: result.messageId };
    },
  };
}

// ── System Capabilities ──────────────────────────────────────

export function createSystemCapabilities(_isDesktopMode = false) {
  return {
    readClipboard: async () => {
      const { stdout } = await execAsync('powershell -Command "Get-Clipboard"', { timeout: 5000 });
      return { text: stdout.trim() };
    },
    writeClipboard: async (text: string) => {
      await execAsync(`echo ${text.replace(/"/g, '\\"')} | clip`, { timeout: 5000 });
      return { written: true };
    },
    sendNotification: async (title: string, message: string) => {
      notifier.notify({ title, message });
      return { sent: true };
    },
    startProcess: async (command: string, args?: string[], cwd?: string) => {
      const fullCommand = args ? `${command} ${args.join(' ')}` : command;
      const blocked = detectDangerousCommand(fullCommand);
      if (blocked) throw new Error(`Command blocked for safety: ${blocked}`);

      const child = spawn(command, args ?? [], {
        cwd,
        detached: true,
        shell: false,
        windowsHide: true,
      });
      return { pid: child.pid! };
    },
    killProcess: async (pid: number) => {
      if (pid < 100) throw new Error('Refusing to kill system process');
      try {
        process.kill(pid);
        return { killed: true };
      } catch (e: any) {
        return { killed: false, error: e.message };
      }
    },
    showOpenDialog: async (
      _options?: {
        multiple?: boolean;
        filters?: { name: string; extensions: string[] }[];
      },
    ) => {
      return {
        paths: [],
        error:
          'Dialog only available in desktop mode. Use read_file with a known path instead.',
      };
    },
  };
}

/** Build capabilities from server context. Pass `allowed` to restrict capability areas. */
export function createAllCapabilities(
  ctx: CapabilitiesContext,
  allowed?: Array<'file' | 'web' | 'shell' | 'scheduler' | 'knowledge' | 'evaluation' | 'lsp'>,
  defaultProjectId?: string,
) {
  const all = {
    ...createFileCapabilities(ctx),
    ...createWebCapabilities(ctx),
    ...createShellCapabilities(ctx),
    ...createSchedulerCapabilities(ctx, defaultProjectId),
    ...createKnowledgeCapabilities(ctx),
    ...createEvaluationCapabilities(ctx),
    ...createLSPCapabilities(),
    ...createSystemKnowledgeCapabilities(ctx),
    ...createDocumentCapabilities(),
    ...createArchiveCapabilities(),
    ...createBrowserCapabilities(),
    ...createCommunicationCapabilities(),
    ...createSystemCapabilities(),
  };
  if (!allowed || allowed.length === 0) return all;
  const areaMap: Record<string, string[]> = {
    file: [
      'readFile',
      'writeFile',
      'listFiles',
      'searchFiles',
      'readDirectory',
      'makeDirectory',
      'moveFile',
      'copyFile',
      'deleteFile',
      'removeDirectory',
      'readFileChunk',
      'globFiles',
    ],
    web: ['httpGet', 'httpPost'],
    shell: ['execCommand'],
    scheduler: ['scheduleTask', 'listScheduledTasks', 'cancelTask'],
    knowledge: ['searchKnowledge', 'indexDocument', 'queryDocument', 'clearDocumentIndex'],
    evaluation: ['evaluateQuality'],
    lsp: ['workspaceSymbols', 'goToDefinition', 'findReferences', 'diagnostics'],
  };
  const permitted = new Set<string>();
  for (const area of allowed) {
    for (const key of areaMap[area] ?? []) permitted.add(key);
  }
  const filtered: any = {};
  for (const key of permitted) {
    if (key in all) filtered[key] = (all as any)[key];
  }
  return filtered as typeof all;
}
