import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { readdirSync, statSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CABINET_DIR } from '@cabinet/storage';

const PROJECTS_DIR = join(CABINET_DIR, 'projects');

export const projectsRouter = new Hono();

function writeProjectIndex(project: {
  id: string; name: string; description?: string; rootPath?: string;
  archived?: boolean; lastActivityAt?: string; createdAt?: string;
}): void {
  const indexPath = join(PROJECTS_DIR, `${project.id}.json`);
  writeFileSync(indexPath, JSON.stringify({
    id: project.id,
    name: project.name,
    description: project.description ?? '',
    rootPath: project.rootPath ?? '',
    archived: project.archived ?? false,
    lastActivityAt: project.lastActivityAt ?? new Date().toISOString(),
    createdAt: project.createdAt ?? new Date().toISOString(),
  }, null, 2), 'utf-8');
}

function removeProjectIndex(id: string): void {
  const indexPath = join(PROJECTS_DIR, `${id}.json`);
  try { unlinkSync(indexPath); } catch { /* ok */ }
}

// ── GET /api/projects ──
projectsRouter.get('/', (c) => {
  const { db } = getServerContext();
  const showArchived = c.req.query('archived') === 'true';

  const rows = db
    .prepare(
      `SELECT p.*, COUNT(DISTINCT w.id) as workflow_count
       FROM projects p
       LEFT JOIN workflows w ON w.project_id = p.id
       WHERE p.archived = ?
       GROUP BY p.id
       ORDER BY p.last_activity_at DESC`,
    )
    .all(showArchived ? 1 : 0) as any[];

  const projects = rows.map(rowToProject);
  return c.json({ projects });
});

// ── GET /api/projects/index (lightweight L1 metadata for Secretary) ──
projectsRouter.get('/index', (c) => {
  const { db } = getServerContext();

  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.last_activity_at,
              COUNT(DISTINCT w.id) as workflow_count
       FROM projects p
       LEFT JOIN workflows w ON w.project_id = p.id
       WHERE p.archived = 0
       GROUP BY p.id
       ORDER BY p.last_activity_at DESC`,
    )
    .all() as any[];

  const index = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    lastActivityAt: r.last_activity_at,
    activeWorkflowCount: r.workflow_count,
  }));

  return c.json({ projects: index });
});

// ── POST /api/projects ──
const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  rootPath: z.string().optional(),
});

projectsRouter.post('/', async (c) => {
  const { db, logger } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const d = parsed.data;
  const id = `proj_${Date.now()}`;

  db.prepare(
    `INSERT INTO projects (id, name, description, root_path, last_activity_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(id, d.name, d.description ?? '', d.rootPath ?? '');

  // Create project_context entry
  db.prepare('INSERT INTO project_context (project_id, summary) VALUES (?, ?)').run(id, '');

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;

  // Write project index file
  writeProjectIndex({
    id, name: d.name, description: d.description, rootPath: d.rootPath,
  });

  logger.info('Project created', { id, name: d.name });

  return c.json({ project: rowToProject(row) }, 201);
});

// ── GET /api/projects/:id ──
projectsRouter.get('/:id', (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  if (!row) return c.json({ error: 'Project not found' }, 404);

  // Load project context
  const ctx = db.prepare('SELECT * FROM project_context WHERE project_id = ?').get(id) as any;

  return c.json({
    project: rowToProject(row),
    context: ctx
      ? {
          summary: ctx.summary,
          goals: JSON.parse(ctx.goals ?? '[]'),
          constraints: JSON.parse(ctx.constraints ?? '{}'),
          techSummary: ctx.tech_summary,
          riskMap: JSON.parse(ctx.risk_map ?? '[]'),
          keyDecisions: JSON.parse(ctx.key_decisions ?? '[]'),
        }
      : null,
  });
});

// ── PUT /api/projects/:id ──
projectsRouter.put('/:id', async (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ error: 'Project not found' }, 404);

  const sets: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (['name', 'description', 'root_path', 'icon'].includes(k)) {
      sets.push(`${k} = ?`);
      params.push(v);
    }
  }

  if (sets.length > 0) {
    params.push(id);
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    logger.info('Project updated', { id });
  }

  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  return c.json({ project: rowToProject(row) });
});

// ── POST /api/projects/:id/archive ──
projectsRouter.post('/:id/archive', (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');
  db.prepare('UPDATE projects SET archived = 1 WHERE id = ?').run(id);
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  if (row) writeProjectIndex(rowToProject(row));
  logger.info('Project archived', { id });
  return c.json({ archived: true });
});

// ── POST /api/projects/:id/restore ──
projectsRouter.post('/:id/restore', (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');
  db.prepare('UPDATE projects SET archived = 0 WHERE id = ?').run(id);
  const restored = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  if (restored) writeProjectIndex(rowToProject(restored));
  logger.info('Project restored', { id });
  return c.json({ restored: true });
});

// ── DELETE /api/projects/:id ──
projectsRouter.delete('/:id', (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');

  // Cascade cleanup
  db.prepare('DELETE FROM project_context WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM workflows WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM decisions WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM employees WHERE project_id = ?').run(id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);

  // Remove project index file
  removeProjectIndex(id);

  logger.info('Project deleted', { id });
  return c.json({ deleted: true });
});

// ── GET /api/projects/:id/files ──
projectsRouter.get('/:id/files', (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  const row = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(id) as any;
  if (!row?.root_path) return c.json({ files: [], rootPath: null });

  const rootPath = row.root_path;
  if (!existsSync(rootPath)) return c.json({ files: [], rootPath });

  const files = collectFileTree(rootPath, rootPath);
  return c.json({ files, rootPath });
});

// ── GET /api/projects/:id/context ──
projectsRouter.get('/:id/context', (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const ctx = db.prepare('SELECT * FROM project_context WHERE project_id = ?').get(id) as any;

  // Also load recent decisions for this project
  const decisions = db
    .prepare(
      "SELECT id, title, status, level FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 10",
    )
    .all(id) as any[];

  return c.json({
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
    },
    context: ctx
      ? {
          summary: ctx.summary,
          goals: JSON.parse(ctx.goals ?? '[]'),
          constraints: JSON.parse(ctx.constraints ?? '{}'),
          techSummary: ctx.tech_summary,
          riskMap: JSON.parse(ctx.risk_map ?? '[]'),
          keyDecisions: JSON.parse(ctx.key_decisions ?? '[]'),
        }
      : null,
    recentDecisions: decisions,
  });
});

// ── Helper ──
function rowToProject(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    rootPath: row.root_path ?? '',
    archived: row.archived === 1,
    lastActivityAt: row.last_activity_at,
    icon: row.icon ?? 'folder',
    workflowCount: row.workflow_count ?? 0,
    createdAt: row.created_at,
  };
}

function collectFileTree(rootPath: string, currentPath: string, maxDepth = 4): any[] {
  const results: any[] = [];
  if (maxDepth <= 0) return results;

  try {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files and node_modules
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = join(currentPath, entry.name);
      const relPath = relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        results.push({
          name: entry.name,
          path: relPath,
          type: 'directory',
          children: collectFileTree(rootPath, fullPath, maxDepth - 1),
        });
      } else {
        try {
          const stat = statSync(fullPath);
          results.push({
            name: entry.name,
            path: relPath,
            type: 'file',
            size: stat.size,
          });
        } catch {
          results.push({ name: entry.name, path: relPath, type: 'file' });
        }
      }
    }
  } catch {
    // Permission issues — skip
  }

  return results;
}
