//
// Autopilot API — manage autopilot triggers and webhook endpoints.
//

import { Hono } from 'hono';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getServerContext } from '../context.js';
import { AutopilotRepository } from '@cabinet/storage';
import { TriggerExecutor } from '@cabinet/agent';

export const autopilotRouter = new Hono();

// ── Helpers ──────────────────────────────────────────────────────

function getRepo(): AutopilotRepository {
  return new AutopilotRepository(getServerContext().db);
}

function getExecutor(): TriggerExecutor {
  const ctx = getServerContext();
  return new TriggerExecutor(getRepo(), ctx.daemon);
}

// ── GET /api/autopilots ──────────────────────────────────────────

autopilotRouter.get('/', (c) => {
  const repo = getRepo();
  const wsId = c.req.query('workspace_id') ?? undefined;
  const triggers = repo.findAll(wsId);
  return c.json({ triggers, count: triggers.length });
});

// ── POST /api/autopilots ─────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  workspace_id: z.string().default('default'),
  trigger_type: z.enum(['cron', 'webhook', 'manual']),
  cron_expression: z.string().optional(),
  cron_timezone: z.string().default('UTC'),
  target_agent_id: z.string().min(1),
  target_workflow_id: z.string().optional(),
  input_template: z.string().default(''),
  enabled: z.boolean().default(true),
  max_retries: z.number().int().min(0).max(10).default(3),
  timeout_ms: z.number().int().min(1000).max(3_600_000).default(300_000),
});

autopilotRouter.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
    }

    const d = parsed.data;
    const repo = getRepo();

    // Generate webhook token for webhook triggers
    const webhookToken = d.trigger_type === 'webhook'
      ? `wh_${crypto.randomBytes(16).toString('hex')}`
      : null;

    const id = `at_${Date.now()}`;
    repo.create({
      id,
      name: d.name,
      description: d.description ?? null,
      workspace_id: d.workspace_id,
      trigger_type: d.trigger_type,
      cron_expression: d.cron_expression ?? null,
      cron_timezone: d.cron_timezone,
      webhook_token: webhookToken,
      webhook_secret: null,
      webhook_last_called_at: null,
      target_agent_id: d.target_agent_id,
      target_workflow_id: d.target_workflow_id ?? null,
      input_template: d.input_template,
      enabled: d.enabled ? 1 : 0,
      max_retries: d.max_retries,
      timeout_ms: d.timeout_ms,
    });

    // Schedule cron if applicable
    if (d.trigger_type === 'cron' && d.cron_expression && d.enabled) {
      const ctx = getServerContext();
      if (ctx.triggerScheduler) {
        const trigger = repo.findById(id)!;
        ctx.triggerScheduler.scheduleCron(trigger);
      }
    }

    return c.json({ id, webhook_token: webhookToken, webhook_url: webhookToken ? `/api/webhooks/autopilots/${webhookToken}` : null }, 201);
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to create autopilot trigger', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── GET /api/autopilots/:id ──────────────────────────────────────

autopilotRouter.get('/:id', (c) => {
  const repo = getRepo();
  const trigger = repo.findById(c.req.param('id'));
  if (!trigger) return c.json({ error: 'Trigger not found' }, 404);
  return c.json(trigger);
});

// ── PATCH /api/autopilots/:id ────────────────────────────────────

autopilotRouter.patch('/:id', async (c) => {
  try {
    const body = await c.req.json();
    const repo = getRepo();
    const existing = repo.findById(c.req.param('id'));
    if (!existing) return c.json({ error: 'Trigger not found' }, 404);

    const updates: Record<string, unknown> = {};
    const allowedFields = ['name', 'description', 'cron_expression', 'cron_timezone',
      'target_agent_id', 'target_workflow_id', 'input_template', 'enabled', 'max_retries', 'timeout_ms'];
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }
    if ('enabled' in updates) updates.enabled = updates.enabled ? 1 : 0;

    repo.update(existing.id, updates as any);

    // Reschedule cron if changed
    const ctx = getServerContext();
    if (ctx.triggerScheduler) {
      ctx.triggerScheduler.unscheduleCron(existing.id);
      if (existing.trigger_type === 'cron' && (updates.cron_expression || updates.enabled !== 0)) {
        const updated = repo.findById(existing.id)!;
        if (updated.enabled && updated.cron_expression) {
          ctx.triggerScheduler.scheduleCron(updated);
        }
      }
    }

    return c.json({ id: existing.id, updated: Object.keys(updates) });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to update autopilot trigger', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── DELETE /api/autopilots/:id ───────────────────────────────────

autopilotRouter.delete('/:id', (c) => {
  const repo = getRepo();
  const existing = repo.findById(c.req.param('id'));
  if (!existing) return c.json({ error: 'Trigger not found' }, 404);

  const ctx = getServerContext();
  if (ctx.triggerScheduler) {
    ctx.triggerScheduler.unscheduleCron(existing.id);
  }

  repo.delete(existing.id);
  return c.json({ id: existing.id, status: 'deleted' });
});

// ── POST /api/autopilots/:id/trigger (manual) ────────────────────

autopilotRouter.post('/:id/trigger', async (c) => {
  try {
    const repo = getRepo();
    const trigger = repo.findById(c.req.param('id'));
    if (!trigger) return c.json({ error: 'Trigger not found' }, 404);

    const executor = getExecutor();
    const { runId, taskId } = await executor.fire(trigger);
    return c.json({ run_id: runId, task_id: taskId, status: 'fired' });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Manual trigger failed', { error: String(err) });
    return c.json({ error: String(err) }, 500);
  }
});

// ── GET /api/autopilots/:id/runs ─────────────────────────────────

autopilotRouter.get('/:id/runs', (c) => {
  const executor = getExecutor();
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const runs = executor.getRunHistory(c.req.param('id'), limit);
  return c.json({ runs, count: runs.length });
});

// ── POST /api/autopilots/:id/runs/:runId/retry ───────────────────

autopilotRouter.post('/:id/runs/:runId/retry', async (c) => {
  try {
    const executor = getExecutor();
    const taskId = await executor.retryRun(c.req.param('runId'));
    return c.json({ task_id: taskId, status: 'retried' });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Retry failed', { error: String(err) });
    return c.json({ error: String(err) }, 400);
  }
});

// ── Webhook endpoint (public, no auth — HMAC optional) ───────────

export const webhookRouter = new Hono();

webhookRouter.post('/autopilots/:token', async (c) => {
  try {
    const token = c.req.param('token');
    const body = await c.req.json().catch(() => ({}));
    const signature = c.req.header('x-hub-signature-256') ?? c.req.header('x-signature') ?? undefined;

    const executor = getExecutor();
    const { runId, taskId } = await executor.fireWebhook(token, body, signature);
    return c.json({ run_id: runId, task_id: taskId, status: 'accepted' }, 202);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not found')) return c.json({ error: msg }, 404);
    if (msg.includes('signature')) return c.json({ error: msg }, 401);
    const { logger } = getServerContext();
    logger.error('Webhook failed', { error: msg });
    return c.json({ error: 'Internal error' }, 500);
  }
});
