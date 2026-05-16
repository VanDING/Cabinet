import { Hono } from 'hono';
import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readFile } from 'node:fs/promises';

export const filesRouter = new Hono();

const PROJECT_ROOT = join(process.cwd(), '..', '..', '..');
const VALID_DIRS = ['apps', 'packages', 'tools', 'tests'];

async function scanDir(dir: string, baseDir: string, depth: number): Promise<{ name: string; path: string; isDir: boolean }[]> {
  if (depth > 4) return [];
  const results: { name: string; path: string; isDir: boolean }[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'target' || entry.name === '.git') continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(baseDir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        results.push({ name: entry.name, path: relPath + '/', isDir: true });
        if (depth < 3) {
          results.push(...await scanDir(fullPath, baseDir, depth + 1));
        }
      } else {
        results.push({ name: entry.name, path: relPath, isDir: false });
      }
    }
  } catch {}
  return results;
}

filesRouter.get('/', async (c) => {
  const query = (c.req.query('q') ?? '').toLowerCase();
  try {
    let allFiles: { name: string; path: string; isDir: boolean }[] = [];
    for (const dir of VALID_DIRS) {
      const fullPath = join(PROJECT_ROOT, dir);
      allFiles.push({ name: dir, path: dir + '/', isDir: true });
      allFiles.push(...await scanDir(fullPath, PROJECT_ROOT, 1));
    }
    if (query) {
      allFiles = allFiles.filter(f => f.name.toLowerCase().includes(query) || f.path.toLowerCase().includes(query));
    }
    allFiles = allFiles.filter(f => !f.isDir).slice(0, 50);
    return c.json({ files: allFiles.map(f => ({ name: f.name, path: f.path })) });
  } catch (e) {
    return c.json({ files: [], error: (e as Error).message });
  }
});

// GET /api/files/read?path=... — read file content
filesRouter.get('/read', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'path required' }, 400);

  const fullPath = join(PROJECT_ROOT, filePath);
  // Security: ensure path is within project root
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return c.json({ error: 'Invalid path' }, 403);
  }

  try {
    const content = await readFile(fullPath, 'utf-8');
    return c.json({ path: filePath, content, size: content.length });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 404);
  }
});
