import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { readdirSync, statSync, existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
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
  const { projectRepo, projectContextRepo, logger } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const d = parsed.data;
  const id = `proj_${Date.now()}`;

  projectRepo.create({
    id,
    name: d.name,
    description: d.description ?? '',
    status: 'active',
    rootPath: d.rootPath ?? '',
    createdAt: new Date(),
  });

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
        const goals = detected.techStack.length > 0
          ? [`Set up ${detected.techStack.join('/')} development environment`, 'Review project structure and dependencies']
          : ['Review project structure', 'Set up development workflow'];
        projectContextRepo.update(id, {
          summary: detected.summary,
          goals: JSON.stringify(goals),
          tech_summary: detected.techStack.join(', '),
        });
        logger.info('Project auto-detected', { id, name: d.name, type: detected.projectType, files: detected.fileCount });
      }
    } catch (e) {
      logger.warn('Project auto-detection failed', { id, error: (e as Error).message });
    }
  }

  const project = projectRepo.findById(id)!;

  // Write project index file
  writeProjectIndex({
    id, name: d.name, description: d.description, rootPath: d.rootPath,
  });

  logger.info('Project created', { id, name: d.name });
  broadcast('project_created', { id, name: d.name, timestamp: new Date().toISOString() });

  return c.json({ project: {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    rootPath: project.rootPath ?? '',
    archived: project.archived,
    lastActivityAt: project.lastActivityAt,
    icon: 'folder',
    workflowCount: 0,
    createdAt: project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
  }}, 201);
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
      createdAt: project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
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
  const { projectRepo, db, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = projectRepo.findById(id);
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
    broadcast('project_updated', { id, name: body.name ?? existing.name, timestamp: new Date().toISOString() });
  }

  const updated = projectRepo.findById(id);
  return c.json({ project: {
    id: updated!.id,
    name: updated!.name,
    description: updated!.description,
    status: updated!.status,
    rootPath: updated!.rootPath ?? '',
    archived: updated!.archived,
    lastActivityAt: updated!.lastActivityAt,
    icon: (body as any).icon ?? 'folder',
    workflowCount: 0,
    createdAt: updated!.createdAt instanceof Date ? updated!.createdAt.toISOString() : updated!.createdAt,
  }});
});

// ── POST /api/projects/:id/archive ──
projectsRouter.post('/:id/archive', (c) => {
  const { projectRepo, db, logger } = getServerContext();
  const id = c.req.param('id');
  db.prepare('UPDATE projects SET archived = 1 WHERE id = ?').run(id);
  const project = projectRepo.findById(id);
  if (project) writeProjectIndex({ ...project, createdAt: project.createdAt instanceof Date ? project.createdAt.toISOString() : String(project.createdAt) });
  logger.info('Project archived', { id });
  return c.json({ archived: true });
});

// ── POST /api/projects/:id/restore ──
projectsRouter.post('/:id/restore', (c) => {
  const { projectRepo, db, logger } = getServerContext();
  const id = c.req.param('id');
  db.prepare('UPDATE projects SET archived = 0 WHERE id = ?').run(id);
  const restored = projectRepo.findById(id);
  if (restored) writeProjectIndex({ ...restored, createdAt: restored.createdAt instanceof Date ? restored.createdAt.toISOString() : String(restored.createdAt) });
  logger.info('Project restored', { id });
  return c.json({ restored: true });
});

// ── DELETE /api/projects/:id ──
projectsRouter.delete('/:id', (c) => {
  const { projectRepo, projectContextRepo, decisionRepo, employeeRepo, db, logger } = getServerContext();
  const id = c.req.param('id');

  // Get project name before deletion for broadcast
  const proj = projectRepo.findById(id);
  const projName = proj?.name ?? id;

  // Cascade cleanup
  projectContextRepo.delete(id);
  db.prepare('DELETE FROM workflows WHERE project_id = ?').run(id);
  decisionRepo.deleteByProject(id);
  employeeRepo.deleteByProject(id);
  projectRepo.delete(id);

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

// ── Project Auto-Detection ──────────────────────────────────────

interface DetectedProjectInfo {
  projectType: string;
  summary: string;
  techStack: string[];
  fileCount: number;
}

const PROJECT_TYPE_SIGNATURES: Record<string, { type: string; label: string }> = {
  'package.json': { type: 'node', label: 'Node.js' },
  'tsconfig.json': { type: 'typescript', label: 'TypeScript' },
  'Cargo.toml': { type: 'rust', label: 'Rust' },
  'go.mod': { type: 'go', label: 'Go' },
  'requirements.txt': { type: 'python', label: 'Python' },
  'pyproject.toml': { type: 'python', label: 'Python' },
  'setup.py': { type: 'python', label: 'Python' },
  'Pipfile': { type: 'python', label: 'Python' },
  'Gemfile': { type: 'ruby', label: 'Ruby' },
  'pom.xml': { type: 'java', label: 'Java (Maven)' },
  'build.gradle': { type: 'java', label: 'Java (Gradle)' },
  'composer.json': { type: 'php', label: 'PHP' },
  'CMakeLists.txt': { type: 'cpp', label: 'C/C++ (CMake)' },
  'Makefile': { type: 'make', label: 'Make-based' },
  'Dockerfile': { type: 'docker', label: 'Docker' },
  'docker-compose.yml': { type: 'docker', label: 'Docker Compose' },
  '.git': { type: 'git', label: 'Git repository' },
  'pnpm-workspace.yaml': { type: 'monorepo', label: 'pnpm Monorepo' },
  'lerna.json': { type: 'monorepo', label: 'Lerna Monorepo' },
  'nx.json': { type: 'monorepo', label: 'Nx Monorepo' },
  'turbo.json': { type: 'monorepo', label: 'Turborepo' },
  'next.config.js': { type: 'nextjs', label: 'Next.js' },
  'next.config.ts': { type: 'nextjs', label: 'Next.js' },
  'vite.config.ts': { type: 'vite', label: 'Vite' },
  'vite.config.js': { type: 'vite', label: 'Vite' },
  'astro.config.mjs': { type: 'astro', label: 'Astro' },
  'svelte.config.js': { type: 'svelte', label: 'Svelte' },
  'tailwind.config.js': { type: 'tailwind', label: 'Tailwind CSS' },
  'tailwind.config.ts': { type: 'tailwind', label: 'Tailwind CSS' },
  '.eslintrc.js': { type: 'eslint', label: 'ESLint' },
  '.eslintrc.json': { type: 'eslint', label: 'ESLint' },
  'eslint.config.js': { type: 'eslint', label: 'ESLint' },
  'prettier.config.js': { type: 'prettier', label: 'Prettier' },
  '.prettierrc': { type: 'prettier', label: 'Prettier' },
  '.env': { type: 'env', label: 'Environment config' },
  '.env.example': { type: 'env', label: 'Environment config' },
  'README.md': { type: 'docs', label: 'Documented' },
  'CHANGELOG.md': { type: 'docs', label: 'Changelog' },
  '.github': { type: 'ci', label: 'GitHub Actions' },
  '.gitlab-ci.yml': { type: 'ci', label: 'GitLab CI' },
};

function detectProjectInfo(rootPath: string): DetectedProjectInfo | null {
  const topEntries = readdirSync(rootPath, { withFileTypes: true });
  const topFiles = new Set(topEntries.filter((e) => e.isFile()).map((e) => e.name));
  const topDirs = new Set(topEntries.filter((e) => e.isDirectory()).map((e) => e.name));

  // Detect project type from signature files
  const techStack: string[] = [];
  const detectedTypes: string[] = [];

  for (const [sigFile, info] of Object.entries(PROJECT_TYPE_SIGNATURES)) {
    if (topFiles.has(sigFile) || topDirs.has(sigFile)) {
      if (!detectedTypes.includes(info.type)) {
        detectedTypes.push(info.type);
        techStack.push(info.label);
      }
    }
  }

  // Try to read package.json for more details
  let projectName = basename(rootPath);
  let projectDescription = '';
  if (topFiles.has('package.json')) {
    try {
      const pkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8'));
      if (pkg.name) projectName = pkg.name;
      if (pkg.description) projectDescription = pkg.description;
    } catch { /* ignore malformed JSON */ }
  }

  // Try Cargo.toml
  if (topFiles.has('Cargo.toml')) {
    try {
      const cargo = readFileSync(join(rootPath, 'Cargo.toml'), 'utf-8');
      const nameMatch = cargo.match(/^name\s*=\s*"(.+)"$/m);
      if (nameMatch) projectName = nameMatch[1]!;
      const descMatch = cargo.match(/^description\s*=\s*"(.+)"$/m);
      if (descMatch) projectDescription = descMatch[1]!;
    } catch { /* ignore */ }
  }

  // Count files (shallow, max depth 2 for performance)
  let fileCount = 0;
  function countFiles(dir: string, depth: number): void {
    if (depth > 1) return;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target') continue;
        if (entry.isFile()) fileCount++;
        else if (entry.isDirectory()) countFiles(join(dir, entry.name), depth + 1);
      }
    } catch { /* skip unreadable */ }
  }
  countFiles(rootPath, 0);

  // Build project type string
  const projectType = detectedTypes.length > 0 ? detectedTypes.join('/') : 'unknown';

  // Build summary
  const summaryParts: string[] = [];
  if (projectDescription) {
    summaryParts.push(projectDescription);
  } else {
    const techDesc = techStack.length > 0
      ? `A ${techStack.slice(0, 3).join('/')} project`
      : 'A project';
    summaryParts.push(`${techDesc} located at ${rootPath}.`);
  }
  summaryParts.push(`${fileCount} files detected.`);

  return {
    projectType,
    summary: summaryParts.join(' '),
    techStack: techStack.slice(0, 5), // Cap at 5
    fileCount,
  };
}

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
