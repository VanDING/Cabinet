import { Hono } from 'hono';
import { z } from 'zod';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
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
  };
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
        // Parse frontmatter for name
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        let name = entry.name;
        if (fmMatch) {
          const nameLine = fmMatch[1]!.match(/^name:\s*(.+)$/m);
          if (nameLine) name = nameLine[1]!.trim().replace(/^['"]|['"]$/g, '');
        }
        if (name) {
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

  // Persist to DB (index)
  db.prepare(
    `INSERT INTO skills (id, name, description, kind, input_schema, output_schema, prompt_template, version, status)
     VALUES (?, ?, ?, ?, '{}', '{}', ?, 1, 'active')`,
  ).run(id, d.name, d.description ?? '', d.kind ?? 'tool', d.promptTemplate ?? '');

  // Write SKILL.md to filesystem
  const dir = ensureSkillDir(d.name);
  const skillMd = [
    '---',
    `name: ${d.name}`,
    `description: ${d.description ?? ''}`,
    `kind: ${d.kind ?? 'tool'}`,
    `version: 1`,
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
  db.prepare('UPDATE skills SET name = ?, description = ?, version = ? WHERE id = ?').run(
    body.name ?? existing.name,
    body.description ?? existing.description,
    newVersion,
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

    const response = await gateway.generateText({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
    });
    metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'skill_test' });
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

// ── POST /api/skills/import — import SKILL.md (string content) ──
skillsRouter.post('/import', async (c) => {
  const { db, skillRegistry, logger } = getServerContext();
  const body = await c.req.json();
  const content = body.content as string;
  if (!content) return c.json({ error: 'content is required (SKILL.md text)' }, 400);

  const result = importSkillFromMarkdown(content, skillRegistry);
  if (!result) return c.json({ error: 'Invalid SKILL.md format' }, 400);

  // Write SKILL.md to filesystem
  const dir = ensureSkillDir(result.name);
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');

  // Persist index to DB
  const skill = skillRegistry.load(result.name);
  if (skill) {
    db.prepare(
      `INSERT OR REPLACE INTO skills (id, name, description, kind, input_schema, output_schema, prompt_template, version, status)
       VALUES (?, ?, ?, ?, '{}', '{}', ?, 1, 'active')`,
    ).run(skill.id, skill.name, skill.description, skill.kind, skill.promptTemplate);
  }

  logger.info('Skill imported', { id: result.id, name: result.name });
  return c.json({ id: result.id, name: result.name, status: 'imported', path: join(dir, 'SKILL.md') }, 201);
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
  } as SkillEntry;

  const markdown = exportSkillToMarkdown(skill);
  return c.json({ id, name: row.name, content: markdown, format: 'SKILL.md' });
});
