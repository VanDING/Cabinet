import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

export const decisionsRouter = new Hono();

decisionsRouter.get('/', (c) => {
  const { decisionRepo } = getServerContext();
  const status = c.req.query('status') ?? 'pending';
  const projectId = c.req.query('projectId') ?? 'proj-1';

  try {
    const decisions = status === 'all'
      ? decisionRepo.listByProject(projectId)
      : decisionRepo.listPending(projectId);
    return c.json({ decisions, status, total: decisions.length });
  } catch {
    return c.json({ decisions: [], status, total: 0 });
  }
});

decisionsRouter.get('/:id', (c) => {
  const { decisionService } = getServerContext();
  const decision = decisionService.getById(c.req.param('id'));
  if (!decision) return c.json({ error: 'Decision not found' }, 404);
  return c.json({ decision });
});

const createSchema = z.object({
  projectId: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string(), impact: z.string() })).optional(),
  classification: z.object({
    scopeDescription: z.string().optional(),
    estimatedCost: z.number().optional(),
    permissionLevel: z.string().optional(),
    optionCount: z.number().optional(),
  }).optional(),
  captainId: z.string().optional(),
});

decisionsRouter.post('/', async (c) => {
  const { decisionService } = getServerContext();
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const input = {
    id: `dec_${Date.now()}`,
    projectId: parsed.data.projectId,
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description ?? '',
    options: parsed.data.options ?? [
      { id: 'approve', label: 'Approve', impact: 'Proceed' },
      { id: 'reject', label: 'Reject', impact: 'Decline' },
    ],
    classification: {
      scopeDescription: parsed.data.classification?.scopeDescription ?? parsed.data.title,
      estimatedCostUsd: parsed.data.classification?.estimatedCost ?? 0,
      optionCount: parsed.data.options?.length ?? 2,
      isCrossSession: false,
      involvesFunds: false,
      involvesPermissions: false,
      involvesDataDeletion: false,
      involvesOrgConfig: false,
    },
    captainId: parsed.data.captainId,
  };

  try {
    const decision = decisionService.create(input);
    broadcast('decision_created', { decisionId: decision.id, title: decision.title, level: decision.level });
    return c.json({ decision }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

decisionsRouter.post('/:id/approve', async (c) => {
  const { decisionService } = getServerContext();
  const body = await c.req.json();
  const decision = decisionService.approve(
    c.req.param('id'),
    body.captainId ?? 'captain-1',
    body.chosenOptionId ?? 'approve',
  );
  broadcast('decision_updated', { decisionId: decision.id, status: 'approved' });
  return c.json({ decision });
});

decisionsRouter.post('/:id/reject', async (c) => {
  const { decisionService } = getServerContext();
  const body = await c.req.json();
  const decision = decisionService.reject(c.req.param('id'), body.captainId ?? 'captain-1');
  broadcast('decision_updated', { decisionId: decision.id, status: 'rejected' });
  return c.json({ decision });
});
