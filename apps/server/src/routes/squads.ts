//
// Squad API — manage agent squads and members.
//

import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { SquadRepository } from '@cabinet/storage';

export const squadRouter = new Hono();

function getRepo(): SquadRepository {
  return new SquadRepository(getServerContext().db);
}

// ── GET /api/squads ──────────────────────────────────────────────

squadRouter.get('/', (c) => {
  const repo = getRepo();
  const wsId = c.req.query('workspace_id') ?? undefined;
  const squads = repo.findAll(wsId);
  return c.json({ squads, count: squads.length });
});

// ── POST /api/squads ─────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  workspace_id: z.string().default('default'),
  leader_agent_id: z.string().min(1),
  routing_strategy: z.enum(['auto', 'round_robin', 'leader_decision', 'skill_match']).default('auto'),
  fallback_agent_id: z.string().optional(),
  enabled: z.boolean().default(true),
});

squadRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
    }

    const d = parsed.data;
    const repo = getRepo();
    const id = `sq_${Date.now()}`;
    repo.create({
      id,
      name: d.name,
      description: d.description ?? null,
      workspace_id: d.workspace_id,
      leader_agent_id: d.leader_agent_id,
      routing_strategy: d.routing_strategy,
      fallback_agent_id: d.fallback_agent_id ?? null,
      enabled: d.enabled ? 1 : 0,
    });

    return c.json({ id, name: d.name }, 201);
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to create squad', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── GET /api/squads/:id ──────────────────────────────────────────

squadRouter.get('/:id', (c) => {
  const repo = getRepo();
  const squad = repo.findById(c.req.param('id'));
  if (!squad) return c.json({ error: 'Squad not found' }, 404);

  const members = repo.findMembers(squad.id);
  return c.json({ squad, members: members.map((m) => ({ ...m, skills: JSON.parse(m.skills_json) })) });
});

// ── PUT /api/squads/:id ──────────────────────────────────────────

squadRouter.put('/:id', async (c) => {
  try {
    const body = await c.req.json();
    const repo = getRepo();
    const existing = repo.findById(c.req.param('id'));
    if (!existing) return c.json({ error: 'Squad not found' }, 404);

    const allowedFields = ['name', 'description', 'leader_agent_id', 'routing_strategy', 'fallback_agent_id', 'enabled'];
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }
    if ('enabled' in updates) updates.enabled = updates.enabled ? 1 : 0;

    repo.update(existing.id, updates as any);
    return c.json({ id: existing.id, updated: Object.keys(updates) });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to update squad', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── DELETE /api/squads/:id ───────────────────────────────────────

squadRouter.delete('/:id', (c) => {
  const repo = getRepo();
  if (!repo.findById(c.req.param('id'))) return c.json({ error: 'Squad not found' }, 404);
  repo.delete(c.req.param('id'));
  return c.json({ status: 'deleted' });
});

// ── GET /api/squads/:id/members ──────────────────────────────────

squadRouter.get('/:id/members', (c) => {
  const repo = getRepo();
  const members = repo.findMembers(c.req.param('id'));
  return c.json({ members: members.map((m) => ({ ...m, skills: JSON.parse(m.skills_json) })), count: members.length });
});

// ── POST /api/squads/:id/members ─────────────────────────────────

const addMemberSchema = z.object({
  agent_id: z.string().min(1),
  member_type: z.enum(['ai', 'human']).default('ai'),
  skills: z.array(z.string()).default([]),
  priority: z.number().int().min(0).default(0),
  max_concurrent_tasks: z.number().int().min(1).default(3),
});

squadRouter.post('/:id/members', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = addMemberSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
    }

    const repo = getRepo();
    if (!repo.findById(c.req.param('id'))) return c.json({ error: 'Squad not found' }, 404);

    const d = parsed.data;
    const id = `sm_${Date.now()}`;
    repo.addMember({
      id,
      squad_id: c.req.param('id'),
      agent_id: d.agent_id,
      member_type: d.member_type,
      skills_json: JSON.stringify(d.skills),
      priority: d.priority,
      max_concurrent_tasks: d.max_concurrent_tasks,
      active: 1,
    });

    return c.json({ id, agent_id: d.agent_id }, 201);
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to add squad member', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── PATCH /api/squads/:id/members/:memberId ──────────────────────

squadRouter.patch('/:id/members/:memberId', async (c) => {
  try {
    const body = await c.req.json();
    const repo = getRepo();

    const allowedFields = ['skills_json', 'priority', 'max_concurrent_tasks', 'active'];
    const updates: Record<string, unknown> = {};
    if (body.skills && Array.isArray(body.skills)) updates.skills_json = JSON.stringify(body.skills);
    for (const field of allowedFields) {
      if (field in body && field !== 'skills_json') updates[field] = body[field];
    }
    if (Object.keys(updates).length === 0) return c.json({ error: 'No valid fields to update' }, 400);

    repo.updateMember(c.req.param('memberId'), updates as any);
    return c.json({ id: c.req.param('memberId'), updated: Object.keys(updates) });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to update squad member', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── DELETE /api/squads/:id/members/:memberId ─────────────────────

squadRouter.delete('/:id/members/:memberId', (c) => {
  const repo = getRepo();
  repo.removeMember(c.req.param('memberId'));
  return c.json({ status: 'deleted' });
});
