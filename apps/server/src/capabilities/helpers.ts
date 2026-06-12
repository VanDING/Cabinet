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
import { join, relative, dirname, extname, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export const execAsync = promisify(exec);

export const RAG_DEFAULT_TOP_K = 5;

export async function readTextFile(filePath: string): Promise<string> {
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

export const MIME_MAP: Record<string, string> = {
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

export const TEXT_EXTENSIONS = new Set([
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

export function isTextFile(ext: string): boolean {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext || ext.length > 10) return true;
  return false;
}

// ── Path safety ──

export async function resolveSafePath(filePath: string): Promise<string> {
  const fullPath = resolve(filePath);
  try {
    return await realpath(fullPath);
  } catch {
    // File does not exist — return normalized path without boundary checks
    return fullPath;
  }
}

// ── Glob / regex helpers ──

export function globToRegex(pattern: string): RegExp {
  let re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  if (pattern.startsWith('*')) re = '.*' + re.slice(2);
  return new RegExp('^' + re + '$');
}

export function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
  }
}

// ── Network safety ──

export function isInternalIP(hostname: string): boolean {
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

export function extractTitle(html: string, contentType: string): string | undefined {
  if (!contentType.includes('html')) return undefined;
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim().slice(0, 200);
}

// ── Shell safety ──

export const SAFE_ENV_KEYS = new Set([
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

export function buildSafeEnv(): Record<string, string> {
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

export interface ChunkResult {
  content: string;
  startChar: number;
  endChar: number;
}

export function chunkText(text: string, chunkSize = 800, overlap = 100): ChunkResult[] {
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

export function cosineSimilarity(a: number[], b: number[]): number {
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

// ── Command allowlist & safe execution ──

export const ALLOWED_COMMANDS = new Set([
  'git',
  'npm',
  'npx',
  'node',
  'python3',
  'python',
  'rustc',
  'cargo',
  'go',
  'javac',
  'java',
  'docker',
  'ls',
  'cat',
  'echo',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'rm',
  'grep',
  'find',
  'wc',
  'head',
  'tail',
  'sort',
  'uniq',
  'chmod',
  'chown',
]);

/** Sub-command restrictions for commands that need extra guarding. */
export const COMMAND_RESTRICTIONS: Record<string, string[]> = {
  docker: ['ps', 'logs', 'images', 'info', 'version', 'inspect'],
  rm: [], // only rm <file>, no flags like -rf
};

export const SHELL_META = /[;&|><$(){}[\]*?`\n\r]/;

export function parseCommand(command: string): string[] | null {
  if (SHELL_META.test(command)) return null;
  return command.trim().split(/\s+/).filter(Boolean);
}

export function isAllowedCommand(cmd: string, args: string[]): boolean {
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

export function extractTextFromHtml(html: string): string {
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
