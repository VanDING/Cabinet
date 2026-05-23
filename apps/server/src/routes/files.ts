import { Hono } from 'hono';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { getServerContext } from '../context.js';

export const filesRouter = new Hono();

const PROJECT_ROOT = join(process.cwd(), '..', '..', '..');
const VALID_DIRS = ['apps', 'packages', 'tools', 'tests'];

// Sensitive files and patterns that must not be readable via the API
const SENSITIVE_PATTERNS = [
  /\.env(\..*)?$/,
  /\.db$/,
  /\.db-.*$/,
  /\.sqlite$/,
  /\.sqlite3$/,
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /\.pfx$/,
  /\.p12$/,
];
const SENSITIVE_EXACT = new Set([
  '.gitignore',
  '.dockerignore',
  '.npmrc',
  'pnpm-lock.yaml',
  'CABINET.md',
]);

async function scanDir(
  dir: string,
  baseDir: string,
  depth: number,
): Promise<{ name: string; path: string; isDir: boolean }[]> {
  if (depth > 4) return [];
  const results: { name: string; path: string; isDir: boolean }[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === 'target' ||
        entry.name === '.git'
      )
        continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        results.push({ name: entry.name, path: relPath + '/', isDir: true });
        if (depth < 3) {
          results.push(...(await scanDir(fullPath, baseDir, depth + 1)));
        }
      } else {
        results.push({ name: entry.name, path: relPath, isDir: false });
      }
    }
  } catch {
    /* directory read failed, return empty results */
  }
  return results;
}

filesRouter.get('/', async (c) => {
  const query = (c.req.query('q') ?? '').toLowerCase();
  try {
    let allFiles: { name: string; path: string; isDir: boolean }[] = [];
    for (const dir of VALID_DIRS) {
      const fullPath = join(PROJECT_ROOT, dir);
      allFiles.push({ name: dir, path: dir + '/', isDir: true });
      allFiles.push(...(await scanDir(fullPath, PROJECT_ROOT, 1)));
    }
    if (query) {
      allFiles = allFiles.filter(
        (f) => f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query),
      );
    }
    allFiles = allFiles.filter((f) => !f.isDir).slice(0, 50);
    return c.json({ files: allFiles.map((f) => ({ name: f.name, path: f.path })) });
  } catch (e) {
    return c.json({ files: [], error: (e as Error).message });
  }
});

// GET /api/files/read?path=...&projectId=... — read file content
filesRouter.get('/read', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'path required' }, 400);

  const projectId = c.req.query('projectId');
  let root = PROJECT_ROOT;

  // If projectId provided, resolve against that project's rootPath
  if (projectId) {
    try {
      const { projectRepo } = getServerContext();
      const project = projectRepo.findById(projectId);
      if (project?.rootPath) {
        root = resolve(project.rootPath);
      }
    } catch { /* fall back to default PROJECT_ROOT */ }
  }

  const fullPath = resolve(root, filePath);
  // Security: ensure path is within resolved root
  if (!fullPath.startsWith(root)) {
    return c.json({ error: 'Invalid path' }, 403);
  }

  // Security: block sensitive files
  const baseName = filePath.split('/').pop() || filePath;
  if (SENSITIVE_EXACT.has(baseName) || SENSITIVE_PATTERNS.some((p) => p.test(baseName))) {
    return c.json({ error: 'Access denied' }, 403);
  }

  try {
    const content = await readFile(fullPath, 'utf-8');
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
      'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
      'pdf': 'application/pdf', 'json': 'application/json',
      'md': 'text/markdown', 'html': 'text/html', 'css': 'text/css', 'js': 'text/javascript',
      'ts': 'text/typescript', 'tsx': 'text/typescript', 'jsx': 'text/javascript',
    };
    return c.json({ path: filePath, content, size: content.length, encoding: 'utf-8', mimeType: mimeMap[ext] ?? 'text/plain' });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 404);
  }
});
