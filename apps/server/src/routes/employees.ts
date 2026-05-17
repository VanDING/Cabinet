import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';

export const employeesRouter = new Hono();

// GET /api/employees — includes both employees and agent_roles
employeesRouter.get('/', (c) => {
  const { db } = getServerContext();
  const empRows = db.prepare('SELECT * FROM employees ORDER BY name ASC').all() as any[];
  const employees = empRows.map(rowToEmployee);

  // Also include custom agents from agent_roles table
  const agentRows = db
    .prepare('SELECT type, name, description, model, allowed_tools FROM agent_roles WHERE is_builtin = 0 ORDER BY name ASC')
    .all() as any[];
  const agentsFromRoles = agentRows.map((r: any) => ({
    id: `agent_${r.type}`,
    name: r.name,
    role: r.type,
    kind: 'ai' as const,
    model: r.model,
    expertise: (() => { try { return JSON.parse(r.allowed_tools ?? '[]'); } catch { return []; } })(),
    permissionLevel: 'read',
    status: 'active',
    projectId: 'default',
  }));

  return c.json({ employees: [...employees, ...agentsFromRoles] });
});

// POST /api/employees
const createSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  kind: z.enum(['ai', 'human']).optional(),
  model: z.string().optional(),
  expertise: z.array(z.string()).optional(),
  permissionLevel: z.string().optional(),
  status: z.string().optional(),
  projectId: z.string().optional(),
});

employeesRouter.post('/', async (c) => {
  const { db, logger } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const d = parsed.data;
  const id = `emp_${Date.now()}`;
  const persona = JSON.stringify({
    model: d.model ?? null,
    expertise: d.expertise ?? [],
    status: d.status ?? 'active',
  });

  db.prepare(
    'INSERT INTO employees (id, project_id, name, role, kind, persona, permission_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    d.projectId ?? 'default',
    d.name,
    d.role ?? 'advisor',
    d.kind ?? 'ai',
    persona,
    d.permissionLevel ?? 'read',
  );

  const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as any;
  logger.info('Employee created', { id, name: d.name });
  return c.json({ employee: rowToEmployee(row) }, 201);
});

// PUT /api/employees/:id
employeesRouter.put('/:id', async (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as any;
  if (!existing) return c.json({ error: 'Employee not found' }, 404);

  const oldPersona = JSON.parse(existing.persona ?? '{}');
  const newPersona = JSON.stringify({
    model: body.model ?? oldPersona.model ?? null,
    expertise: body.expertise ?? oldPersona.expertise ?? [],
    status: body.status ?? oldPersona.status ?? 'active',
  });

  db.prepare(
    'UPDATE employees SET name = ?, role = ?, kind = ?, persona = ?, permission_level = ? WHERE id = ?',
  ).run(
    body.name ?? existing.name,
    body.role ?? existing.role,
    body.kind ?? existing.kind,
    newPersona,
    body.permissionLevel ?? existing.permission_level,
    id,
  );

  const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as any;
  logger.info('Employee updated', { id });
  return c.json({ employee: rowToEmployee(row) });
});

// DELETE /api/employees/:id
employeesRouter.delete('/:id', (c) => {
  const { db, logger } = getServerContext();
  const id = c.req.param('id');
  db.prepare('DELETE FROM employees WHERE id = ?').run(id);
  logger.info('Employee deleted', { id });
  return c.json({ status: 'deleted' });
});

// ── Helper ──
function rowToEmployee(row: any) {
  const persona = (() => {
    try {
      return JSON.parse(row.persona ?? '{}');
    } catch {
      return {};
    }
  })();
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    kind: row.kind,
    model: persona.model ?? undefined,
    expertise: persona.expertise ?? [],
    permissionLevel: row.permission_level,
    status: persona.status ?? 'active',
    projectId: row.project_id,
  };
}
