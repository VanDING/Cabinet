import { Hono } from 'hono';
import { z } from 'zod';
import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  cpSync,
} from 'node:fs';
import AdmZip from 'adm-zip';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { importSkillFromMarkdown, exportSkillToMarkdown } from '@cabinet/agent';
import type { SkillEntry } from '@cabinet/agent';
import { CABINET_DIR } from '@cabinet/storage';
import { injectAgentSkillTools } from '../context/skills.js';

const SKILLS_DIR = join(CABINET_DIR, 'skills');

export const skillsRouter = new Hono();

function ensureSkillDir(name: string): string {
  const dir = join(SKILLS_DIR, name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureSubdir(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function rowToSkill(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    version: row.version,
    status: row.status,
    promptTemplate: row.prompt_template,
    inputSchema: JSON.parse(row.input_schema ?? '{}'),
    outputSchema: JSON.parse(row.output_schema ?? '{}'),
    metadata: JSON.parse(row.metadata ?? '{}'),
    referencesPath: row.references_path ?? '',
    scriptsPath: row.scripts_path ?? '',
  };
}

function persistSkillToDb(
  skillRepo: import('@cabinet/storage').SkillRepository,
  skill: SkillEntry,
) {
  skillRepo.upsert({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    kind: skill.kind,
    input_schema: '{}',
    output_schema: '{}',
    prompt_template: skill.promptTemplate,
    version: skill.version,
    status: 'active',
    metadata: JSON.stringify(skill.metadata ?? {}),
    references_path: skill.referencesPath ?? '',
    scripts_path: skill.scriptsPath ?? '',
  });
}

// ── GET /api/skills — list from DB + filesystem scan ──
skillsRouter.get('/', (c) => {
  const { skillRepo } = getServerContext();
  const rows = skillRepo.findAll();
  const dbSkills = rows.map(rowToSkill);

  // Scan filesystem for skills not yet in DB
  const dbNames = new Set(dbSkills.map((s) => s.name));
  try {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const entry of dirs) {
      if (dbNames.has(entry.name)) continue;
      const skillMdPath = join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;
      try {
        const content = readFileSync(skillMdPath, 'utf-8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let name = entry.name;
        if (fmMatch) {
          const nameLine = fmMatch[1]!.match(/^name:\s*(.+)$/m);
          if (nameLine) name = nameLine[1]!.trim().replace(/^['"]|['"]$/g, '');
        }
        if (name) {
          const refsDir = join(SKILLS_DIR, entry.name, 'references');
          const scriptsDir = join(SKILLS_DIR, entry.name, 'scripts');
          dbSkills.push({
            id: `skill_fs_${name}`,
            name,
            description: '',
            kind: 'tool',
            version: 1,
            status: 'active',
            promptTemplate: '',
            inputSchema: {},
            outputSchema: {},
            metadata: {},
            referencesPath: existsSync(refsDir) ? refsDir : '',
            scriptsPath: existsSync(scriptsDir) ? scriptsDir : '',
          });
        }
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* skills dir empty */
  }

  return c.json({ skills: dbSkills, directory: SKILLS_DIR });
});

// ── POST /api/skills — create skill + write SKILL.md ──
const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(['tool', 'prompt', 'composite']).optional(),
  promptTemplate: z.string().optional(),
  exposure: z.enum(['prompt', 'tool', 'both']).optional().default('both'),
});

skillsRouter.post('/', async (c) => {
  const { skillRepo, logger, skillRegistry } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const id = `skill_${Date.now()}`;
  const d = parsed.data;

  const dir = ensureSkillDir(d.name);
  const refsDir = join(dir, 'references');
  const scriptsDir = join(dir, 'scripts');

  // Persist to DB (index)
  skillRepo.insert({
    id,
    name: d.name,
    description: d.description ?? '',
    kind: d.kind ?? 'tool',
    input_schema: '{}',
    output_schema: '{}',
    prompt_template: d.promptTemplate ?? '',
    version: 1,
    status: 'active',
    metadata: '{}',
    references_path: existsSync(refsDir) ? refsDir : '',
    scripts_path: existsSync(scriptsDir) ? scriptsDir : '',
    exposure: d.exposure,
  });

  // Write SKILL.md to filesystem
  const skillMd = [
    '---',
    `name: ${d.name}`,
    `description: ${d.description ?? ''}`,
    `kind: ${d.kind ?? 'tool'}`,
    'version: 1',
    'status: active',
    '---',
    '',
    d.promptTemplate ?? '',
  ].join('\n');
  writeFileSync(join(dir, 'SKILL.md'), skillMd, 'utf-8');

  // Sync to runtime registry
  skillRegistry.register({
    id,
    name: d.name,
    description: d.description ?? '',
    kind: (d.kind ?? 'tool') as SkillEntry['kind'],
    exposure: d.exposure as SkillEntry['exposure'],
    promptTemplate: d.promptTemplate ?? '',
    inputSchema: {},
    outputSchema: {},
    version: 1,
    status: 'active',
    referencesPath: existsSync(refsDir) ? refsDir : '',
    scriptsPath: existsSync(scriptsDir) ? scriptsDir : '',
    metadata: {},
  });

  broadcast('skill_created', { id, name: d.name });
  logger.info('Skill registered', { id, name: d.name });
  // Re-inject skill tools into agents
  const { mastra } = getServerContext();
  if (mastra) injectAgentSkillTools(mastra, skillRegistry);
  return c.json({ id, status: 'registered', name: d.name, path: join(dir, 'SKILL.md') }, 201);
});

// ── PUT /api/skills/:id ──
skillsRouter.put('/:id', async (c) => {
  const { skillRepo, skillRegistry, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  const existing = skillRepo.findById(id);
  if (!existing) return c.json({ error: 'Skill not found' }, 404);

  const newVersion = existing.version + 1;
  const name = body.name ?? existing.name;
  skillRepo.update(id, {
    name,
    description: body.description ?? existing.description,
    version: newVersion,
    metadata: JSON.stringify(body.metadata ?? JSON.parse(existing.metadata ?? '{}')),
  });

  // Update runtime registry
  const regSkill = skillRegistry.load(existing.name);
  if (regSkill) {
    skillRegistry.register({
      ...regSkill,
      name,
      description: body.description ?? existing.description,
      version: newVersion,
      promptTemplate: body.promptTemplate ?? existing.prompt_template ?? regSkill.promptTemplate,
      metadata: body.metadata ?? regSkill.metadata ?? {},
    });
  }

  // Update SKILL.md
  const dir = ensureSkillDir(name);
  const skillMd = [
    '---',
    `name: ${name}`,
    `description: ${body.description ?? existing.description}`,
    `kind: ${existing.kind}`,
    `version: ${newVersion}`,
    `status: ${existing.status}`,
    '---',
    '',
    body.promptTemplate ?? existing.prompt_template ?? '',
  ].join('\n');
  writeFileSync(join(dir, 'SKILL.md'), skillMd, 'utf-8');

  broadcast('skill_updated', { id, name });
  logger.info('Skill updated', { id, name });
  // Re-inject skill tools into agents
  const { mastra } = getServerContext();
  if (mastra) injectAgentSkillTools(mastra, skillRegistry);
  return c.json({ id, status: 'updated', version: newVersion });
});

// ── DELETE /api/skills/:id — remove DB entry + skill directory ──
skillsRouter.delete('/:id', (c) => {
  const { skillRepo, skillRegistry, logger } = getServerContext();
  const id = c.req.param('id');

  const row = skillRepo.findById(id);
  if (row) {
    // Remove from filesystem
    const skillDir = join(SKILLS_DIR, row.name);
    try {
      rmSync(skillDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
    // Remove from registry
    skillRegistry.unregister(row.name);
    // Remove from DB
    skillRepo.delete(id);
    broadcast('skill_deleted', { id, name: row.name });
    logger.info('Skill deleted', { id, name: row.name });
    // Re-inject skill tools into agents (remove deleted skill)
    const { mastra } = getServerContext();
    if (mastra) injectAgentSkillTools(mastra, skillRegistry);
  }
  return c.json({ status: 'deleted' });
});

// ── POST /api/skills/:id/test ──
skillsRouter.post('/:id/test', async (c) => {
  return c.json(
    { error: 'Skill testing migrated to Mastra. Use Mastra agent API to test skills.' },
    503,
  );
});

// ── POST /api/skills/import — import SKILL.md text ──
skillsRouter.post('/import', async (c) => {
  const { skillRepo, skillRegistry, logger } = getServerContext();
  const body = await c.req.json();
  const content = (body.content || body.markdown) as string;
  if (!content) return c.json({ error: 'content is required (SKILL.md text)' }, 400);

  const dir = join(SKILLS_DIR, '_import_temp');
  const result = importSkillFromMarkdown(content, skillRegistry, {
    referencesPath: join(dir, 'references'),
    scriptsPath: join(dir, 'scripts'),
  });
  if (!result)
    return c.json(
      { error: 'Invalid SKILL.md format. Expected YAML frontmatter with name + description.' },
      400,
    );

  // Write SKILL.md to filesystem
  const skillDir = ensureSkillDir(result.name);
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');

  // Update runtime paths
  const refsDir = join(skillDir, 'references');
  const scriptsDir = join(skillDir, 'scripts');
  const skill = skillRegistry.load(result.name);
  if (skill) {
    skill.referencesPath = existsSync(refsDir) ? refsDir : '';
    skill.scriptsPath = existsSync(scriptsDir) ? scriptsDir : '';
    persistSkillToDb(skillRepo, skill);
  }

  broadcast('skill_created', { id: result.id, name: result.name });
  logger.info('Skill imported', { id: result.id, name: result.name });
  // Re-inject skill tools into agents
  const { mastra } = getServerContext();
  if (mastra) injectAgentSkillTools(mastra, skillRegistry);
  return c.json(
    {
      id: result.id,
      name: result.name,
      status: 'imported',
      path: join(skillDir, 'SKILL.md'),
    },
    201,
  );
});

// ── POST /api/skills/import-zip — import full skill zip with directory structure ──
skillsRouter.post('/import-zip', async (c) => {
  const { skillRepo, skillRegistry, logger } = getServerContext();

  const formData = await c.req.formData();
  const zipFile = formData.get('file');
  if (!zipFile || !(zipFile instanceof File)) {
    return c.json({ error: 'zip file is required (multipart field: file)' }, 400);
  }

  let zip: AdmZip;
  try {
    const buf = Buffer.from(await zipFile.arrayBuffer());
    zip = new AdmZip(buf);
  } catch {
    return c.json({ error: 'Invalid or corrupt zip file' }, 400);
  }

  // Find SKILL.md in zip (priority: root > */SKILL.md > any **/SKILL.md)
  const entries = zip.getEntries();
  let skillMdEntry = entries.find((e) => e.entryName === 'SKILL.md' && !e.isDirectory);
  if (!skillMdEntry) {
    skillMdEntry = entries.find((e) => /^[^/]+\/SKILL\.md$/i.test(e.entryName) && !e.isDirectory);
  }
  if (!skillMdEntry) {
    skillMdEntry = entries.find((e) => /SKILL\.md$/i.test(e.entryName) && !e.isDirectory);
  }
  if (!skillMdEntry) {
    return c.json({ error: 'No SKILL.md found in the archive' }, 400);
  }

  const skillContent = skillMdEntry.getData().toString('utf-8');

  // Parse to get the skill name before extracting
  const result = importSkillFromMarkdown(skillContent, skillRegistry);
  if (!result) {
    return c.json(
      { error: 'Invalid SKILL.md format. Expected YAML frontmatter with name + description.' },
      400,
    );
  }

  // Determine the base path inside the zip (e.g. "my-skill/" or "" for root-level)
  const isRoot = skillMdEntry.entryName === 'SKILL.md';
  const zipBase = isRoot ? '' : skillMdEntry.entryName.replace(/SKILL\.md$/i, '');

  // Extract full directory to ~/.cabinet/skills/<name>/
  const skillDir = ensureSkillDir(result.name);

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    // Compute relative path inside the skill directory
    let relPath = entry.entryName;
    if (zipBase && relPath.startsWith(zipBase)) {
      relPath = relPath.slice(zipBase.length);
    }
    if (!relPath || relPath === 'SKILL.md') continue;

    const destPath = join(skillDir, relPath);
    try {
      ensureSubdir(join(destPath, '..'));
      writeFileSync(destPath, entry.getData());
    } catch {
      /* skip individual file errors */
    }
  }

  // Also ensure SKILL.md is at root of skill dir
  writeFileSync(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');

  // Update runtime paths
  const refsDir = join(skillDir, 'references');
  const scriptsDir = join(skillDir, 'scripts');
  const skill = skillRegistry.load(result.name);
  if (skill) {
    skill.referencesPath = existsSync(refsDir) ? refsDir : '';
    skill.scriptsPath = existsSync(scriptsDir) ? scriptsDir : '';
    persistSkillToDb(skillRepo, skill);
  }

  broadcast('skill_created', { id: result.id, name: result.name });
  logger.info('Skill zip imported', { id: result.id, name: result.name });
  // Re-inject skill tools into agents
  const { mastra } = getServerContext();
  if (mastra) injectAgentSkillTools(mastra, skillRegistry);
  return c.json(
    {
      id: result.id,
      name: result.name,
      status: 'imported',
      path: join(skillDir, 'SKILL.md'),
      hasReferences: existsSync(refsDir),
      hasScripts: existsSync(scriptsDir),
    },
    201,
  );
});

// ── GET /api/skills/:id/export — export as SKILL.md ──
skillsRouter.get('/:id/export', (c) => {
  const { skillRepo, skillRegistry } = getServerContext();
  const id = c.req.param('id');

  const row = skillRepo.findById(id);
  if (!row) return c.json({ error: 'Skill not found' }, 404);

  const skill =
    skillRegistry.load(row.name) ??
    ({
      id: row.id,
      name: row.name,
      description: row.description,
      kind: row.kind,
      promptTemplate: row.prompt_template,
      inputSchema: {},
      outputSchema: {},
      version: row.version,
      status: row.status,
      metadata: JSON.parse(row.metadata ?? '{}'),
    } as SkillEntry);

  const markdown = exportSkillToMarkdown(skill);
  return c.json({ id, name: row.name, content: markdown, format: 'SKILL.md' });
});
