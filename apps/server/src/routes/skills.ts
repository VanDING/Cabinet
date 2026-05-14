import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';

export const skillsRouter = new Hono();

function rowToSkill(row: any) {
  return {
    id: row.id, name: row.name, description: row.description,
    kind: row.kind, version: row.version, status: row.status,
    promptTemplate: row.prompt_template,
  };
}

skillsRouter.get('/', (c) => {
  const { db } = getServerContext();
  const rows = db.prepare('SELECT * FROM skills ORDER BY version DESC').all() as any[];
  return c.json({ skills: rows.map(rowToSkill) });
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(['tool', 'prompt', 'composite']).optional(),
  promptTemplate: z.string().optional(),
});

skillsRouter.post('/', async (c) => {
  const { db, logger } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const id = `skill_${Date.now()}`;
  db.prepare(
    `INSERT INTO skills (id, name, description, kind, input_schema, output_schema, prompt_template, version, status)
     VALUES (?, ?, ?, ?, '{}', '{}', ?, 1, 'active')`
  ).run(id, parsed.data.name, parsed.data.description ?? '', parsed.data.kind ?? 'tool', parsed.data.promptTemplate ?? '');
  logger.info('Skill registered', { id, name: parsed.data.name });
  return c.json({ id, status: 'registered', name: parsed.data.name }, 201);
});

skillsRouter.put('/:id', async (c) => {
  const { db } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();
  const existing = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ error: 'Skill not found' }, 404);

  db.prepare('UPDATE skills SET name = ?, description = ?, version = ? WHERE id = ?')
    .run(body.name ?? existing.name, body.description ?? existing.description, existing.version + 1, id);
  return c.json({ id, status: 'updated' });
});

skillsRouter.delete('/:id', (c) => {
  const { db } = getServerContext();
  db.prepare('DELETE FROM skills WHERE id = ?').run(c.req.param('id'));
  return c.json({ status: 'deleted' });
});

skillsRouter.post('/:id/test', async (c) => {
  const body = await c.req.json();
  return c.json({
    skillId: c.req.param('id'),
    output: `Test completed for: ${(body.input as string)?.slice(0, 100) ?? '(empty)'}`,
  });
});
