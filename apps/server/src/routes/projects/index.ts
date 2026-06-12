import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../../context.js';
import { broadcast } from '../../ws/handler.js';
import { CABINET_DIR } from '@cabinet/storage';
import {
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  accessSync,
  constants,
} from 'node:fs';
import { join } from 'node:path';
import { writeProjectIndex, removeProjectIndex } from './persistence.js';
import { detectProjectInfo } from './auto-detect.js';
import { rowToProject, collectFileTree } from './helpers.js';

export const projectsRouter = new Hono();

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
  const { projectRepo, projectContextRepo, logger } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const d = parsed.data;

  // Name uniqueness check
  const existing = projectRepo.findByName(d.name);
  if (existing) {
    return c.json({ error: 'Project name already exists' }, 409);
  }

  // Pre-validation for import paths
  if (d.rootPath) {
    if (!existsSync(d.rootPath)) {
      return c.json({ error: `rootPath does not exist: ${d.rootPath}` }, 400);
    }
    const s = statSync(d.rootPath);
    if (!s.isDirectory()) {
      return c.json({ error: `rootPath is not a directory: ${d.rootPath}` }, 400);
    }
    try {
      accessSync(d.rootPath, constants.W_OK);
    } catch {
      return c.json({ error: `rootPath is not writable: ${d.rootPath}` }, 400);
    }
  }

  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  projectRepo.create({
    id,
    name: d.name,
    description: d.description ?? '',
    status: 'active',
    rootPath: d.rootPath ?? '',
    createdAt: new Date(),
  });

  // Initialize physical project directory
  const isImport = !!(d.rootPath && existsSync(d.rootPath));
  const projectDir = isImport ? d.rootPath! : join(CABINET_DIR, 'projects', d.name);

  try {
    if (isImport) {
      // Ensure .cabinet/ config dirs exist inside the imported folder
      mkdirSync(join(projectDir, '.cabinet', 'rules'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'skills'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'mcp'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'sessions'), { recursive: true });
    } else if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'rules'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'skills'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'mcp'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'sessions'), { recursive: true });
      mkdirSync(join(projectDir, 'deliverables'), { recursive: true });
    } else {
      // Reuse existing folder but clean old data (preserve .cabinet/ config)
      const entries = readdirSync(projectDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.cabinet') continue;
        const fullPath = join(projectDir, entry.name);
        rmSync(fullPath, { recursive: true, force: true });
      }
      // Ensure .cabinet subdirs exist even when reusing
      mkdirSync(join(projectDir, '.cabinet', 'rules'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'skills'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'mcp'), { recursive: true });
      mkdirSync(join(projectDir, '.cabinet', 'sessions'), { recursive: true });
    }

    // Generate CABINET.md stub if not exists
    const cabinetMdPath = join(projectDir, 'CABINET.md');
    if (!existsSync(cabinetMdPath)) {
      writeFileSync(
        cabinetMdPath,
        '# CABINET.md\n\nThis file provides guidance to Cabinet when working with code in this repository.\n<!-- Run /init to fill this file -->\n',
        'utf-8',
      );
    }
  } catch (err) {
    // Rollback: delete the project record we just created
    try {
      projectRepo.delete(id);
    } catch {
      /* ignore rollback failure */
    }
    logger.error('Failed to initialize project directory', {
      id,
      error: (err as Error).message,
    });
    return c.json(
      {
        error: `Failed to initialize project directory: ${(err as Error).message}`,
      },
      500,
    );
  }

  // Update rootPath to the actual project directory
  projectRepo.update(id, { rootPath: projectDir });

  // Create project_context entry
  projectContextRepo.insert({
    project_id: id,
    summary: '',
    goals: '[]',
    milestones: '[]',
    constraints: '{}',
    tech_summary: '',
    risk_map: '[]',
    key_decisions: '[]',
    updated_at: new Date().toISOString(),
  });

  // Auto-detect project info from directory if rootPath provided
  if (d.rootPath && existsSync(d.rootPath)) {
    try {
      const detected = detectProjectInfo(d.rootPath);
      if (detected) {
        const goals =
          detected.techStack.length > 0
            ? [
                `Set up ${detected.techStack.join('/')} development environment`,
                'Review project structure and dependencies',
              ]
            : ['Review project structure', 'Set up development workflow'];
        projectContextRepo.update(id, {
          summary: detected.summary,
          goals: JSON.stringify(goals),
          tech_summary: detected.techStack.join(', '),
        });
        logger.info('Project auto-detected', {
          id,
          name: d.name,
          type: detected.projectType,
          files: detected.fileCount,
        });
      }
    } catch (e) {
      logger.warn('Project auto-detection failed', { id, error: (e as Error).message });
    }
  }

  const project = projectRepo.findById(id)!;

  // Write project index file
  writeProjectIndex({
    id,
    name: d.name,
    description: d.description,
    rootPath: projectDir,
  });

  logger.info('Project created', { id, name: d.name });
  broadcast('project_created', { id, name: d.name, timestamp: new Date().toISOString() });

  return c.json(
    {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        status: project.status,
        rootPath: project.rootPath ?? '',
        archived: project.archived,
        lastActivityAt: project.lastActivityAt,
        icon: 'folder',
        workflowCount: 0,
        createdAt:
          project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
      },
    },
    201,
  );
});

// ── GET /api/projects/:id ──
projectsRouter.get('/:id', (c) => {
  const { projectRepo, projectContextRepo } = getServerContext();
  const id = c.req.param('id');
  const project = projectRepo.findById(id);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  // Load project context
  const ctx = projectContextRepo.findByProjectId(id);

  return c.json({
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      rootPath: project.rootPath ?? '',
      archived: project.archived,
      lastActivityAt: project.lastActivityAt,
      icon: 'folder',
      workflowCount: 0,
      createdAt:
        project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
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
  });
});

// ── PUT /api/projects/:id ──
projectsRouter.put('/:id', async (c) => {
  const { projectRepo, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = projectRepo.findById(id);
  if (!existing) return c.json({ error: 'Project not found' }, 404);

  const changes: Partial<Pick<typeof existing, 'name' | 'description' | 'rootPath'>> & {
    icon?: string;
  } = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'name') changes.name = String(v);
    if (k === 'description') changes.description = String(v);
    if (k === 'root_path') changes.rootPath = String(v);
    if (k === 'icon') changes.icon = String(v);
  }

  if (Object.keys(changes).length > 0) {
    projectRepo.update(id, changes);
    logger.info('Project updated', { id });
    broadcast('project_updated', {
      id,
      name: body.name ?? existing.name,
      timestamp: new Date().toISOString(),
    });
  }

  const updated = projectRepo.findById(id);
  return c.json({
    project: {
      id: updated!.id,
      name: updated!.name,
      description: updated!.description,
      status: updated!.status,
      rootPath: updated!.rootPath ?? '',
      archived: updated!.archived,
      lastActivityAt: updated!.lastActivityAt,
      icon: (body as any).icon ?? 'folder',
      workflowCount: 0,
      createdAt:
        updated!.createdAt instanceof Date ? updated!.createdAt.toISOString() : updated!.createdAt,
    },
  });
});

// ── POST /api/projects/:id/archive ──
projectsRouter.post('/:id/archive', (c) => {
  const { projectRepo, logger } = getServerContext();
  const id = c.req.param('id');
  projectRepo.archive(id);
  const project = projectRepo.findById(id);
  if (project)
    writeProjectIndex({
      ...project,
      createdAt:
        project.createdAt instanceof Date
          ? project.createdAt.toISOString()
          : String(project.createdAt),
    });
  logger.info('Project archived', { id });
  return c.json({ archived: true });
});

// ── POST /api/projects/:id/restore ──
projectsRouter.post('/:id/restore', (c) => {
  const { projectRepo, logger } = getServerContext();
  const id = c.req.param('id');
  projectRepo.restore(id);
  const restored = projectRepo.findById(id);
  if (restored)
    writeProjectIndex({
      ...restored,
      createdAt:
        restored.createdAt instanceof Date
          ? restored.createdAt.toISOString()
          : String(restored.createdAt),
    });
  logger.info('Project restored', { id });
  return c.json({ restored: true });
});

// ── DELETE /api/projects/:id ──
projectsRouter.delete('/:id', (c) => {
  const { projectRepo, projectContextRepo, decisionRepo, employeeRepo, workflowRepo, db, logger } =
    getServerContext();
  const id = c.req.param('id');

  // Get project name before deletion for broadcast
  const proj = projectRepo.findById(id);
  const projName = proj?.name ?? id;

  // Atomic cascade cleanup
  db.transaction(() => {
    projectContextRepo.delete(id);
    workflowRepo.deleteByProject(id);
    decisionRepo.deleteByProject(id);
    employeeRepo.deleteByProject(id);
    projectRepo.delete(id);
  })();

  // Remove project index file
  removeProjectIndex(id);

  logger.info('Project deleted', { id });
  broadcast('project_deleted', { id, name: projName, timestamp: new Date().toISOString() });
  return c.json({ deleted: true });
});

// ── GET /api/projects/:id/files ──
projectsRouter.get('/:id/files', (c) => {
  const { projectRepo } = getServerContext();
  const id = c.req.param('id');
  const project = projectRepo.findById(id);
  if (!project?.rootPath) return c.json({ files: [], rootPath: null });

  const rootPath = project.rootPath;
  if (!existsSync(rootPath)) return c.json({ files: [], rootPath });

  const files = collectFileTree(rootPath, rootPath);
  return c.json({ files, rootPath });
});

// ── GET /api/projects/:id/context ──
projectsRouter.get('/:id/context', (c) => {
  const { projectRepo, projectContextRepo, decisionRepo } = getServerContext();
  const id = c.req.param('id');

  const project = projectRepo.findById(id);
  if (!project) return c.json({ error: 'Project not found' }, 404);

  const ctx = projectContextRepo.findByProjectId(id);

  // Also load recent decisions for this project
  const decisions = decisionRepo.listByProject(id, { limit: 10 });

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
