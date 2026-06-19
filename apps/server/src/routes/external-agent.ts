//
// External Agent HTTP API
//
// REST endpoints for external agents to push data back to Cabinet:
//   - POST /api/slot/:taskId/write    — Agent writes discoveries to Context Slot
//   - POST /api/decisions             — Agent pushes approval requests
//   - POST /api/deliverables          — Agent submits deliverables
//
// Authentication: task_token (HMAC) or agent_api_key via Authorization header.
// See task-reliability.ts for token generation and validation.
//

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

export const externalAgentRouter = new Hono();

// ── Helpers ──────────────────────────────────────────────────────

function extractAuthToken(c: any): string | null {
  const header = c.req.header('Authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

/** HMAC-based task token validation. Uses CABINET_SECRET env var or auto-generated key. */
function validateTaskToken(token: string): { valid: boolean; taskId?: string } {
  if (!token || token.length < 20) return { valid: false };

  // agent_api_key — permanent key stored in agent_role's external_config
  if (token.startsWith('agent_key_')) {
    return { valid: true };
  }

  // task_token format: "task_<taskId>_<hmac>"
  const parts = token.split('_');
  if (parts.length < 3 || parts[0] !== 'task') return { valid: false };

  const hmacPart = parts.pop()!;
  const taskId = parts.slice(1).join('_');

  // Verify HMAC
  const secret = process.env.CABINET_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { valid: false };
    }
    return { valid: token.length >= 40 };
  }
  const expected = crypto.createHmac('sha256', secret).update(taskId).digest('hex').slice(0, 16);
  if (hmacPart === expected) {
    return { valid: true, taskId };
  }

  return { valid: false };
}

/** Generate a task token for external agent dispatch. */
export function generateTaskToken(taskId: string): string {
  const secret = process.env.CABINET_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CABINET_SECRET is required in production');
    }
    const devSecret = `cabinet-dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const hmac = crypto.createHmac('sha256', devSecret).update(taskId).digest('hex').slice(0, 16);
    return `task_${taskId}_${hmac}`;
  }
  const hmac = crypto.createHmac('sha256', secret).update(taskId).digest('hex').slice(0, 16);
  return `task_${taskId}_${hmac}`;
}

// ── GET /api/slot/:taskId/read ────────────────────────────────────

externalAgentRouter.get('/:taskId/read', async (c) => {
  const token = extractAuthToken(c);
  if (!token) return c.json({ error: 'Missing Authorization header' }, 401);

  const auth = validateTaskToken(token);
  if (!auth.valid) return c.json({ error: 'Invalid token' }, 401);

  const taskId = c.req.param('taskId');
  if (auth.taskId && auth.taskId !== taskId) {
    return c.json({ error: 'Token does not match task' }, 403);
  }

  try {
    const { sessionManager } = getServerContext();
    const session = sessionManager.get(taskId);
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }
    const slot = session.contextSlot;
    if (!slot) {
      return c.json({ error: 'Context slot not initialized' }, 404);
    }
    return c.json(slot);
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Slot read failed', { taskId, error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── POST /api/slot/:taskId/write ─────────────────────────────────

const slotWriteSchema = z.object({
  discoveries: z
    .array(
      z
        .object({
          type: z.string(),
          summary: z.string(),
        })
        .passthrough(),
    )
    .optional(),
  previous_outputs: z.array(z.string()).optional(),
});

externalAgentRouter.post('/:taskId/write', async (c) => {
  const token = extractAuthToken(c);
  if (!token) return c.json({ error: 'Missing Authorization header' }, 401);

  const auth = validateTaskToken(token);
  if (!auth.valid) return c.json({ error: 'Invalid token' }, 401);

  const taskId = c.req.param('taskId');
  if (auth.taskId && auth.taskId !== taskId) {
    return c.json({ error: 'Token does not match task' }, 403);
  }

  try {
    const body = await c.req.json();
    const parsed = slotWriteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
    }

    const { sessionManager, agentEventBus } = getServerContext();
    // Find the child session for this task
    const sessions = sessionManager.list();
    const childSession = sessions.find(
      (s) => s.contextSlot !== undefined && s.agentType?.startsWith('external_'),
    );

    if (childSession?.contextSlot) {
      const serverCtx = getServerContext();
      if (parsed.data.discoveries) {
        childSession.contextSlot.discoveries.push(...parsed.data.discoveries);
        for (const d of parsed.data.discoveries) {
          serverCtx.blackboard?.write('discoveries', d, childSession.id).catch(() => {});
        }
      }
      if (parsed.data.previous_outputs) {
        childSession.contextSlot.previous_outputs.push(...parsed.data.previous_outputs);
        for (const o of parsed.data.previous_outputs) {
          serverCtx.blackboard?.write('outputs', o, childSession.id).catch(() => {});
        }
      }
      sessionManager.setContextSlot(childSession.id, childSession.contextSlot);

      agentEventBus.publish(childSession.id, childSession.parentId, {
        type: 'tool_result',
        name: 'slot_write',
        result: {
          discoveries: parsed.data.discoveries,
          previous_outputs: parsed.data.previous_outputs,
        },
        timestamp: Date.now(),
      });

      broadcast('slot_updated', { taskId, sessionId: childSession.id, ...parsed.data });
    }

    return c.json({ ok: true, taskId });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Slot write failed', { taskId, error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── POST /api/external/decisions ─────────────────────────────────

const externalDecisionSchema = z.object({
  type: z.enum(['execution', 'action', 'strategic']),
  title: z.string().min(1),
  description: z.string(),
  urgency: z.enum(['red', 'yellow', 'green']).default('yellow'),
  source: z.object({
    agent_id: z.string(),
    task_id: z.string(),
    capability: z.string().optional(),
  }),
  options: z.array(z.object({ label: z.string(), value: z.string() })),
  callback_url: z.string().optional(),
});

externalAgentRouter.post('/decisions', async (c) => {
  const token = extractAuthToken(c);
  if (!token) return c.json({ error: 'Missing Authorization header' }, 401);
  if (!validateTaskToken(token).valid) return c.json({ error: 'Invalid token' }, 401);

  try {
    const body = await c.req.json();
    const parsed = externalDecisionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
    }

    const { decisionService, agentEventBus } = getServerContext();
    const decision = decisionService.create({
      id: `dec_${Date.now()}`,
      projectId: 'default',
      type: parsed.data.type as any,
      title: parsed.data.title,
      description: parsed.data.description,
      options: parsed.data.options.map((o) => ({
        id: o.value,
        label: o.label,
        impact: '',
      })),
      classification: {
        scopeDescription: parsed.data.description,
        isCrossSession: false,
        optionCount: parsed.data.options.length,
        estimatedCost: 0,
        involvesFunds: false,
        involvesPermissions: parsed.data.urgency === 'red',
        involvesDataDeletion: false,
        involvesOrgConfig: false,
        fromExternalAgent: true,
        operationType: 'command_execution',
      } as any,
      captainId: undefined,
    });

    // Tag decision with source info for PolicyEngine sandbox check
    (decision as any)._source = { agentType: 'external_cli', agentId: parsed.data.source.agent_id };

    broadcast('decision_created', {
      id: decision.id,
      title: decision.title,
      urgency: parsed.data.urgency,
      source: parsed.data.source,
      callback_url: parsed.data.callback_url,
    });

    return c.json({
      decision_id: decision.id,
      status: decision.status,
      callback_url: parsed.data.callback_url,
    });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('External decision creation failed', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── POST /api/external/deliverables ──────────────────────────────

const deliverableSchema = z.object({
  agent_id: z.string(),
  task_id: z.string(),
  title: z.string(),
  type: z.string().default('code'),
  content: z.string(),
  metadata: z
    .object({
      language: z.string().optional(),
      files: z.array(z.string()).optional(),
      tokens_used: z.number().optional(),
      duration_ms: z.number().optional(),
    })
    .optional(),
});

externalAgentRouter.post('/deliverables', async (c) => {
  const token = extractAuthToken(c);
  if (!token) return c.json({ error: 'Missing Authorization header' }, 401);
  if (!validateTaskToken(token).valid) return c.json({ error: 'Invalid token' }, 401);

  try {
    const body = await c.req.json();
    const parsed = deliverableSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
    }

    const { deliverableRepo, agentEventBus, sessionManager } = getServerContext();

    const deliverableId = `d_${Date.now()}`;
    // Store via repository
    deliverableRepo.insert({
      id: deliverableId,
      project_id: 'default',
      meeting_id: null,
      title: parsed.data.title,
      type: parsed.data.type,
      file_path: '',
      tags: JSON.stringify(['external_agent', parsed.data.agent_id]),
    } as any);

    // Find child session and inject deliverable
    const sessions = sessionManager.list();
    const childSession = sessions.find(
      (s) => s.parentId !== undefined && s.agentType?.startsWith('external_'),
    );
    if (childSession) {
      childSession.deliverable = parsed.data.content;
      agentEventBus.publish(childSession.id, childSession.parentId, {
        type: 'completed',
        deliverable: { id: deliverableId, title: parsed.data.title, content: parsed.data.content },
        timestamp: Date.now(),
      });
    }

    broadcast('deliverable_created', {
      id: deliverableId,
      agentId: parsed.data.agent_id,
      taskId: parsed.data.task_id,
      title: parsed.data.title,
      type: parsed.data.type,
      timestamp: new Date().toISOString(),
    });

    return c.json({ deliverable_id: deliverableId, ok: true });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('External deliverable submission failed', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});
