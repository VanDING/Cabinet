import { Hono } from 'hono';
import { z } from 'zod';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { CABINET_DIR } from '@cabinet/storage';
import { getServerContext } from '../context.js';

export const employeesRouter = new Hono();

// GET /api/employees — includes both employees and agent_roles
employeesRouter.get('/', (c) => {
  const { employeeRepo, agentRoleRepo, agentRegistry } = getServerContext();
  const empRows = employeeRepo.findAll();
  const employees = empRows.map(rowToEmployee);

  // Also include custom agents from agent_roles table
  const agentRows = agentRoleRepo.findCustom();
  const dbAgentNames = new Set(agentRows.map((r) => r.name));
  const agentsFromRoles = agentRows.map((r) => ({
    id: `agent_${r.name}`,
    name: r.name,
    role: r.type,
    kind: 'ai' as const,
    model: r.model,
    expertise: (() => {
      try {
        return JSON.parse(r.allowed_tools ?? '[]');
      } catch {
        return [];
      }
    })(),
    permissionLevel: 'read',
    status: 'active',
    projectId: 'default',
  }));

  // Fallback: include runtime-registered agents that may not yet be in DB
  const runtimeAgents = agentRegistry
    .list()
    .filter((r) => r.type === 'custom' && !dbAgentNames.has(r.name))
    .map((r) => ({
      id: `agent_${r.name}`,
      name: r.name,
      role: r.type,
      kind: 'ai' as const,
      model: r.modelTier ?? undefined,
      expertise: r.allowedTools ?? [],
      permissionLevel: 'read',
      status: 'active',
      projectId: 'default',
    }));

  return c.json({ employees: [...employees, ...agentsFromRoles, ...runtimeAgents] });
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
  allowedTools: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});

employeesRouter.post('/', async (c) => {
  const { employeeRepo, projectRepo, logger } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const d = parsed.data;
  if (!d.projectId || d.projectId === 'global') {
    return c.json({ error: 'projectId is required' }, 400);
  }
  const id = `emp_${Date.now()}`;
  const persona = JSON.stringify({
    model: d.model ?? null,
    expertise: d.expertise ?? [],
    status: d.status ?? 'active',
  });
  const pipelineConfig = d.kind === 'ai' ? JSON.stringify({
    model: d.model ?? 'claude-sonnet-4-6',
    systemPrompt: d.systemPrompt ?? '',
    temperature: d.temperature ?? 0.7,
    maxTokens: d.maxTokens ?? 4000,
  }) : null;

  employeeRepo.insert({
    id,
    project_id: d.projectId,
    name: d.name,
    role: d.role ?? 'advisor',
    kind: d.kind ?? 'ai',
    pipeline_config: pipelineConfig,
    persona,
    permission_level: d.permissionLevel ?? 'read',
    allowed_tools: JSON.stringify(d.allowedTools ?? []),
  });

  const row = employeeRepo.findById(id);
  logger.info('Employee created', { id, name: d.name });
  return c.json({ employee: rowToEmployee(row) }, 201);
});

// PUT /api/employees/:id
employeesRouter.put('/:id', async (c) => {
  const { employeeRepo, logger } = getServerContext();
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = employeeRepo.findById(id);
  if (!existing) return c.json({ error: 'Employee not found' }, 404);

  const oldPersona = JSON.parse(existing.persona ?? '{}');
  const oldPipeline = JSON.parse(existing.pipeline_config ?? '{}');
  const newPersona = JSON.stringify({
    model: body.model ?? oldPersona.model ?? null,
    expertise: body.expertise ?? oldPersona.expertise ?? [],
    status: body.status ?? oldPersona.status ?? 'active',
  });
  const newPipeline = body.kind === 'human' ? null : JSON.stringify({
    model: body.model ?? oldPipeline.model ?? oldPersona.model ?? 'claude-sonnet-4-6',
    systemPrompt: body.systemPrompt ?? oldPipeline.systemPrompt ?? '',
    temperature: body.temperature ?? oldPipeline.temperature ?? 0.7,
    maxTokens: body.maxTokens ?? oldPipeline.maxTokens ?? 4000,
  });

  const updates: Parameters<typeof employeeRepo.update>[1] = {
    name: body.name ?? existing.name,
    role: body.role ?? existing.role,
    kind: body.kind ?? existing.kind,
    persona: newPersona,
    permission_level: body.permissionLevel ?? existing.permission_level,
    pipeline_config: newPipeline,
  };

  if (body.allowedTools !== undefined) {
    updates.allowed_tools = JSON.stringify(body.allowedTools);
  }

  employeeRepo.update(id, updates);

  const row = employeeRepo.findById(id);
  logger.info('Employee updated', { id });
  return c.json({ employee: rowToEmployee(row) });
});

// DELETE /api/employees/:id
employeesRouter.delete('/:id', (c) => {
  const { employeeRepo, agentRoleRepo, agentRegistry, logger } = getServerContext();
  const id = c.req.param('id');

  // Custom agents are stored in agent_roles, not employees table
  if (id.startsWith('agent_')) {
    const name = id.slice('agent_'.length);
    // Allow deletion even if not in runtime registry (may be DB-only after restart)
    const agent = agentRegistry.get(name);
    if (agent) {
      agentRegistry.unregister(name);
    }
    agentRoleRepo.deleteByName(name);

    // Remove from filesystem
    try {
      rmSync(join(CABINET_DIR, 'agents', name), { recursive: true, force: true });
    } catch {
      /* ok */
    }

    logger.info('Agent deleted via employees', { name });
    return c.json({ status: 'deleted' });
  }

  employeeRepo.delete(id);
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
  const pipeline = (() => {
    try {
      return JSON.parse(row.pipeline_config ?? '{}');
    } catch {
      return {};
    }
  })();
  const allowedTools = (() => {
    try {
      return JSON.parse(row.allowed_tools ?? '[]');
    } catch {
      return [];
    }
  })();
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    kind: row.kind,
    model: persona.model ?? pipeline.model ?? undefined,
    expertise: persona.expertise ?? [],
    permissionLevel: row.permission_level,
    status: persona.status ?? 'active',
    projectId: row.project_id,
    allowedTools,
    systemPrompt: pipeline.systemPrompt ?? '',
    temperature: pipeline.temperature ?? 0.7,
    maxTokens: pipeline.maxTokens ?? 4000,
  };
}
