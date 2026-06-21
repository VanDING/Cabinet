import { Hono } from 'hono';
import { z } from 'zod';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { CABINET_DIR } from '@cabinet/storage';
import { getServerContext } from '../context.js';

export const employeesRouter = new Hono();

// GET /api/employees — includes both employees and agent_roles
employeesRouter.get('/', (c) => {
  try {
    const { employeeRepo, agentRoleRepo, agentRegistry, logger } = getServerContext();
    const empRows = employeeRepo.findAll();
    const employees = empRows.map(rowToEmployee);

    // Also include custom agents from agent_roles table
    const agentRows = agentRoleRepo.findCustom();
    const dbAgentNames = new Set(agentRows.map((r) => r.name));
    const agentsFromRoles = agentRows.map((r) => ({
      id: r.type.startsWith('external_') ? r.name : `agent_${r.name}`,
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
      status: r.type.startsWith('external_') ? 'online' : 'active',
      projectId: 'default',
      source: r.type,
    }));

    // Fallback: include runtime-registered agents that may not yet be in DB
    // Includes custom agents AND auto-discovered external agents (external_cli, external_a2a)
    const runtimeAgentTypes = new Set(['custom', 'external_cli', 'external_a2a']);
    const runtimeAgents = agentRegistry
      .list()
      .filter((r) => runtimeAgentTypes.has(r.type) && !dbAgentNames.has(r.name))
      .map((r) => ({
        id: r.type.startsWith('external_') ? r.name : `agent_${r.name}`,
        name: r.name,
        role: r.type,
        kind: 'ai' as const,
        model: r.modelTier ?? undefined,
        expertise: r.allowedTools ?? [],
        permissionLevel: 'read',
        status: r.type.startsWith('external_') ? 'online' : 'active',
        projectId: 'default',
        source: r.type, // e.g. 'external_cli', 'external_a2a' — for UI filtering
      }));

    return c.json({ employees: [...employees, ...agentsFromRoles, ...runtimeAgents] });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to load employees', { error: (err as Error).message });
    return c.json({ employees: [], error: 'Failed to load employees' }, 500);
  }
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
  const pipelineConfig =
    d.kind === 'ai'
      ? JSON.stringify({
          model: d.model ?? 'claude-sonnet-4-6',
          systemPrompt: d.systemPrompt ?? '',
          temperature: d.temperature ?? 0.7,
          maxTokens: d.maxTokens ?? 4000,
        })
      : null;

  // Read source/external from raw body (Zod strips unknown fields from parsed.data)
  const source: string = body.source ?? (d.kind === 'ai' ? 'custom' : 'human');
  const externalConfig: string | null = body.external ? JSON.stringify(body.external) : null;

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
    source,
    external_config: externalConfig,
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
  const newPipeline =
    body.kind === 'human'
      ? null
      : JSON.stringify({
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
  if ((body as any).source !== undefined) {
    (updates as any).source = (body as any).source;
  }
  if ((body as any).external !== undefined) {
    (updates as any).external_config = JSON.stringify((body as any).external);
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
  if (id.startsWith('external_cli:') || id.startsWith('external_a2a:')) {
    const agent = agentRegistry.get(id);
    if (agent) {
      agentRegistry.unregister(id);
    }
    agentRoleRepo.deleteByName(id);
    logger.info('External agent deleted via employees', { name: id });
    return c.json({ status: 'deleted' });
  }

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

// ── POST /:id/test — test employee LLM connection ──
employeesRouter.post('/:id/test', async (c) => {
  const { employeeRepo } = getServerContext();
  const id = c.req.param('id');
  const row = employeeRepo.findById(id);
  if (!row) {
    return c.json({ status: 'error', message: 'Employee not found' }, 404);
  }

  const pipeline = (() => {
    try {
      return JSON.parse(row.pipeline_config ?? '{}');
    } catch {
      return {};
    }
  })();
  const persona = (() => {
    try {
      return JSON.parse(row.persona ?? '{}');
    } catch {
      return {};
    }
  })();
  const model = pipeline.model ?? persona.model;
  if (!model) {
    return c.json({ status: 'error', message: 'No model configured for this employee' }, 400);
  }

  const { AISDKAdapter } = await import('@cabinet/gateway');
  const adapter = new AISDKAdapter({}, {});
  const start = Date.now();
  try {
    const result = await adapter.generateText({
      model,
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    const latency = Date.now() - start;
    return c.json({ status: 'ok', latency_ms: latency, model: result.model });
  } catch (e) {
    return c.json({ status: 'error', message: (e as Error).message ?? 'Connection failed' }, 503);
  }
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
  const external = (() => {
    try {
      return JSON.parse(row.external_config ?? 'null');
    } catch {
      return null;
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
    source: row.source ?? 'custom',
    external,
  };
}
