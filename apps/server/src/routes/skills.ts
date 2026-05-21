import { Hono } from 'hono';
import { z } from 'zod';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, cpSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { getServerContext } from '../context.js';
import { importSkillFromMarkdown, exportSkillToMarkdown } from '@cabinet/agent';
import type { SkillEntry } from '@cabinet/agent';
import { CABINET_DIR } from '@cabinet/storage';

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

function persistSkillToDb(db: any, skill: SkillEntry) {
  db.prepare(
    `INSERT OR REPLACE INTO skills (id, name, description, kind, input_schema, output_schema, prompt_template, version, status, metadata, references_path, scripts_path)
     VALUES (?, ?, ?, ?, '{}', '{}', ?, ?, 'active', ?, ?, ?)`,
  ).run(
    skill.id,
    skill.name,
    skill.description,
    skill.kind,
    skill.promptTemplate,
    skill.version,
    JSON.stringify(skill.metadata ?? {}),
    skill.referencesPath ?? '',
    skill.scriptsPath ?? '',
  );
}

// ── GET /api/skills — list from DB + filesystem scan ──
skillsRouter.get('/', (c) => {
  const { db } = getServerContext();
  const rows = db.prepare('SELECT * FROM skills ORDER BY version DESC').all() as any[];
  const dbSkills = rows.map(rowToSkill);

  // Scan filesystem for skills not yet in DB
  const dbNames = new Set(dbSkills.map((s) => s.name));
  try {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());
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
      } catch { /* skip malformed */ }
    }
  } catch { /* skills dir empty */ }

  return c.json({ skills: dbSkills, directory: SKILLS_DIR });
});

// ── POST /api/skills — create skill + write SKILL.md ──
const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(['tool', 'prompt', 'composite']).optional(),
  promptTemplate: z.string().optional(),
});

skillsRouter.post('/', async (c) => {
  const { db, logger, skillRegistry } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const id = `skill_${Date.now()}`;
  const d = parsed.data;

  const dir = ensureSkillDir(d.name);
  const refsDir = join(dir, 'references');
  const scriptsDir = join(dir, 'scripts');

  // Persist to DB (index)
  db.prepare(
    `INSERT INTO skills (id, name, description, kind, input_schema, output_schema, prompt_template, version, status, metadata, references_path, scripts_path)
     VALUES (?, ?, ?, ?, '{}', '{}', ?, 1, 'active', '{}', ?, ?)`,
  ).run(
    id,
    d.name,
    d.description ?? '',
    d.kind ?? 'tool',
    d.promptTemplate ?? '',
    existsSync(refsDir) ? refsDir : '',
    existsSync(scriptsDir) ? scriptsDir : '',
  );

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
    promptTemplate: d.promptTemplate ?? '',
    inputSchema: {},
    outputSchema: {},
    version: 1,
    status: 'active',
    referencesPath: existsSync(refsDir) ? refsDir : '',
    scriptsPath: existsSync(scriptsDir) ? scriptsDir : '',
    metadata: {},
  });

  logger.info('Skill registered', { id, name: d.name });
  return c.json({ id, status: 'registered', name: d.name, path: join(dir, 'SKILL.md') }, 201);
});

// ── PUT /api/skills/:id ──
skillsRouter.put('/:id', async (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  const existing = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ error: 'Skill not found' }, 404);

  const newVersion = existing.version + 1;
  db.prepare(
    `UPDATE skills SET name = ?, description = ?, version = ?, metadata = ? WHERE id = ?`,
  ).run(
    body.name ?? existing.name,
    body.description ?? existing.description,
    newVersion,
    JSON.stringify(body.metadata ?? JSON.parse(existing.metadata ?? '{}')),
    id,
  );

  // Update SKILL.md
  const name = body.name ?? existing.name;
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

  logger.info('Skill updated', { id, name });
  return c.json({ id, status: 'updated', version: newVersion });
});

// ── DELETE /api/skills/:id — remove DB entry + skill directory ──
skillsRouter.delete('/:id', (c) => {
  const { db, skillRegistry, logger } = getServerContext();
  const id = c.req.param('id');

  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
  if (row) {
    // Remove from filesystem
    const skillDir = join(SKILLS_DIR, row.name);
    try { rmSync(skillDir, { recursive: true, force: true }); } catch { /* ok */ }
    // Remove from registry
    skillRegistry.unregister(row.name);
    // Remove from DB
    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    logger.info('Skill deleted', { id, name: row.name });
  }
  return c.json({ status: 'deleted' });
});

// ── POST /api/skills/:id/test ──
skillsRouter.post('/:id/test', async (c) => {
  const { gateway, db, metrics, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  const input = (body.input as string) ?? '';

  const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
  if (!skill) return c.json({ error: 'Skill not found' }, 404);

  if (!gateway) {
    return c.json({
      skillId: id,
      output: 'No LLM available. Configure API keys to test skills.',
      mode: 'fallback',
    });
  }

  try {
    const prompt = skill.prompt_template
      ? `${skill.prompt_template}\n\nInput: ${input}`
      : `Execute the "${skill.name}" skill. Input: ${input}`;

    const testModel = (gateway as any).resolveModelString?.('default') ?? 'claude-haiku-4-5';
    const response = await gateway.generateText({
      model: testModel,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
    });
    metrics.increment('llm_call', { model: response.model ?? testModel, purpose: 'skill_test' });
    logger.info('Skill test completed', { id, name: skill.name });
    return c.json({
      skillId: id,
      output: response.content,
      model: response.model,
      tokens: response.usage,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ── POST /api/skills/import — import SKILL.md text ──
skillsRouter.post('/import', async (c) => {
  const { db, skillRegistry, logger } = getServerContext();
  const body = await c.req.json();
  const content = (body.content || body.markdown) as string;
  if (!content) return c.json({ error: 'content is required (SKILL.md text)' }, 400);

  const dir = join(SKILLS_DIR, '_import_temp');
  const result = importSkillFromMarkdown(content, skillRegistry, {
    referencesPath: join(dir, 'references'),
    scriptsPath: join(dir, 'scripts'),
  });
  if (!result) return c.json({ error: 'Invalid SKILL.md format. Expected YAML frontmatter with name + description.' }, 400);

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
    persistSkillToDb(db, skill);
  }

  logger.info('Skill imported', { id: result.id, name: result.name });
  return c.json({
    id: result.id,
    name: result.name,
    status: 'imported',
    path: join(skillDir, 'SKILL.md'),
  }, 201);
});

// ── POST /api/skills/import-zip — import full skill zip with directory structure ──
skillsRouter.post('/import-zip', async (c) => {
  const { db, skillRegistry, logger } = getServerContext();

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
    return c.json({ error: 'Invalid SKILL.md format. Expected YAML frontmatter with name + description.' }, 400);
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
    } catch { /* skip individual file errors */ }
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
    persistSkillToDb(db, skill);
  }

  logger.info('Skill zip imported', { id: result.id, name: result.name });
  return c.json({
    id: result.id,
    name: result.name,
    status: 'imported',
    path: join(skillDir, 'SKILL.md'),
    hasReferences: existsSync(refsDir),
    hasScripts: existsSync(scriptsDir),
  }, 201);
});

// ── GET /api/skills/:id/export — export as SKILL.md ──
skillsRouter.get('/:id/export', (c) => {
  const { db, skillRegistry } = getServerContext();
  const id = c.req.param('id');

  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
  if (!row) return c.json({ error: 'Skill not found' }, 404);

  const skill = skillRegistry.load(row.name) ?? {
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
  } as SkillEntry;

  const markdown = exportSkillToMarkdown(skill);
  return c.json({ id, name: row.name, content: markdown, format: 'SKILL.md' });
});
