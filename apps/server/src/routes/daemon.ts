//
// Daemon API — REST endpoints for Agent Daemon task management.
//
// Routes:
//   GET    /api/daemon/status           — daemon health + agent list
//   POST   /api/daemon/agents/discover   — trigger agent re-discovery
//   POST   /api/daemon/tasks             — enqueue a new task
//   GET    /api/daemon/tasks             — list tasks (?status=&agent_id=&limit=)
//   GET    /api/daemon/tasks/:taskId     — task detail + progress
//   POST   /api/daemon/tasks/:taskId/cancel — cancel a task
//   POST   /api/daemon/tasks/:taskId/retry  — retry a failed task
//   POST   /api/daemon/workspaces/gc     — trigger workspace GC
//

import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';

export const daemonRouter = new Hono();

// ── GET /api/daemon/status ───────────────────────────────────────

daemonRouter.get('/status', (c) => {
  const { daemon } = getServerContext();
  return c.json(daemon.getStatus());
});

// ── POST /api/daemon/agents/discover ─────────────────────────────

daemonRouter.post('/agents/discover', async (c) => {
  const { daemon } = getServerContext();
  const results = await daemon.triggerDiscovery();
  return c.json({ discovered: results.length, agents: results });
});

// ── GET /api/daemon/agents ───────────────────────────────────────

daemonRouter.get('/agents', (c) => {
  const { daemon } = getServerContext();
  return c.json({ agents: daemon.getDiscoveredAgents() });
});

// ── POST /api/daemon/tasks ───────────────────────────────────────

const enqueueSchema = z.object({
  agent_id: z.string().min(1),
  session_id: z.string().default('default'),
  capability: z.string().default('default'),
  input: z.union([z.string(), z.record(z.string(), z.unknown())]),
  slot: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(0).max(100).default(0),
  max_retries: z.number().int().min(0).max(10).default(3),
  timeout_ms: z.number().int().min(1000).max(3_600_000).default(300_000),
});

daemonRouter.post('/tasks', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = enqueueSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400);
    }

    const { daemon } = getServerContext();
    const d = parsed.data;
    const slot = d.slot as any;

    // Ensure minimal slot shape
    if (!slot.project) slot.project = { name: 'default', goals: [] };
    if (!slot.security) slot.security = { level: 'L1', maxRetries: d.max_retries };

    const taskId = await daemon.enqueueTask({
      agentId: d.agent_id,
      sessionId: d.session_id,
      capability: d.capability,
      input: d.input,
      slot,
      priority: d.priority,
      maxRetries: d.max_retries,
      timeoutMs: d.timeout_ms,
    });

    return c.json({ task_id: taskId, status: 'pending' }, 201);
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Failed to enqueue task', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── GET /api/daemon/tasks ────────────────────────────────────────

daemonRouter.get('/tasks', (c) => {
  const { daemon } = getServerContext();
  const status = c.req.query('status') ?? undefined;
  const agentId = c.req.query('agent_id') ?? undefined;
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const tasks = daemon.listTasks({ status, agentId, limit });
  return c.json({ tasks, count: tasks.length });
});

// ── GET /api/daemon/tasks/:taskId ─────────────────────────────────

daemonRouter.get('/tasks/:taskId', (c) => {
  const { daemon } = getServerContext();
  const taskId = c.req.param('taskId');
  const task = daemon.getTask(taskId);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  return c.json(task);
});

// ── POST /api/daemon/tasks/:taskId/cancel ────────────────────────

daemonRouter.post('/tasks/:taskId/cancel', (c) => {
  const { daemon } = getServerContext();
  const taskId = c.req.param('taskId');
  const ok = daemon.cancelTask(taskId);
  if (!ok) return c.json({ error: 'Task not found or already completed' }, 404);
  return c.json({ task_id: taskId, status: 'cancelled' });
});

// ── POST /api/daemon/tasks/:taskId/retry ─────────────────────────

daemonRouter.post('/tasks/:taskId/retry', (c) => {
  const { daemon } = getServerContext();
  const taskId = c.req.param('taskId');
  const task = daemon.retryTask(taskId);
  if (!task) return c.json({ error: 'Task not found, not failed, or retries exhausted' }, 400);
  return c.json({ task_id: task.id, status: task.status });
});

// ── POST /api/daemon/workspaces/gc ────────────────────────────────

daemonRouter.post('/workspaces/gc', (c) => {
  const { daemon } = getServerContext();
  const result = daemon.runWorkspaceGC();
  return c.json({ cleaned: result });
});
