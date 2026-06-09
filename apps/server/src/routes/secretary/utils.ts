// Shared utility functions and constants for the Secretary router.
// Extracted from secretary.ts (Phase 1.1 split).

import { join, resolve } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { buildEnvironmentSection } from '../../capabilities.js';

export const execAsync = promisify(exec);

/** Roles that need the system environment section in their prompt. */
export const ROLES_NEEDING_ENV = new Set([
  'secretary',
  'organize',
  'curator',
]);

// ── CABINET.md auto-injection cache ──
export const cabinetMdCache = new Map<string, { content: string; mtime: number }>();

export function loadCabinetMd(projectRootPath: string): string | null {
  const cabinetPath = join(projectRootPath, 'CABINET.md');
  const localPath = join(projectRootPath, 'CABINET.local.md');
  if (!existsSync(cabinetPath) && !existsSync(localPath)) return null;

  try {
    let mtime = 0;
    if (existsSync(cabinetPath)) {
      mtime = Math.max(mtime, statSync(cabinetPath).mtimeMs);
    }
    if (existsSync(localPath)) {
      mtime = Math.max(mtime, statSync(localPath).mtimeMs);
    }
    const cached = cabinetMdCache.get(projectRootPath);
    if (cached && cached.mtime === mtime) return cached.content;

    const parts: string[] = [];
    if (existsSync(cabinetPath)) {
      parts.push(readFileSync(cabinetPath, 'utf-8'));
    }
    if (existsSync(localPath)) {
      parts.push(readFileSync(localPath, 'utf-8'));
    }
    const content = parts.join('\n\n');
    cabinetMdCache.set(projectRootPath, { content, mtime });
    return content;
  } catch {
    return null;
  }
}

export function buildSystemPrompt(
  roleType: string,
  roleSystemPrompt: string,
  projectRootPath?: string,
): string {
  const parts: string[] = [];
  if (ROLES_NEEDING_ENV.has(roleType)) {
    parts.push(buildEnvironmentSection(projectRootPath));
  }
  if (projectRootPath) {
    const cabinetMd = loadCabinetMd(projectRootPath);
    if (cabinetMd) {
      parts.push(`## Project Context (from CABINET.md)\n${cabinetMd}`);
    }
  }
  parts.push(roleSystemPrompt);
  // 4.3 PIS: guide LLM to emit milestone markers so Goal Progress factor works
  parts.push(
    `## Progress Tracking\n` +
    `When you complete a significant sub-task, milestone, or goal, include one of these markers in your response:\n` +
    `- "milestone_complete" — when a major milestone is achieved\n` +
    `- "subtask_done" — when a sub-task is finished\n` +
    `- "goal_achieved" — when the overall goal is reached\n` +
    `This helps the system track progress and maintain focus.`
  );
  return parts.join('\n\n');
}

/** Read a text file with auto-detected encoding (UTF-8 → GBK fallback). */
export async function readTextFile(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString('utf-8').slice(1); // strip BOM
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

// ── File tool helpers ──

export const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.zip': 'application/zip',
  '.tar': 'application/x-tar', '.gz': 'application/gzip',
};

export const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.mdx', '.json', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.scss', '.less', '.html', '.htm', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.proto',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.csv', '.tsv', '.log', '.lock',
]);

export function isTextFile(ext: string): boolean {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext || ext.length > 10) return true;
  return false;
}

export async function resolveSafePath(filePath: string): Promise<string> {
  const fullPath = resolve(filePath);
  try {
    return await realpath(fullPath);
  } catch {
    return fullPath;
  }
}

export const SAFE_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'USERNAME', 'TEMP', 'TMP', 'TMPDIR',
  'SHELL', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM',
  'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'NODE_ENV', 'NODE_PATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'SSH_AUTH_SOCK',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
  'PNPM_HOME', 'npm_config_cache',
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
