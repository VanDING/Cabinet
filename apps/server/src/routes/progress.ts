import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { ProgressTracker } from '@cabinet/harness';

export const progressRouter = new Hono();

// GET /api/progress — get current progress
progressRouter.get('/', (c) => {
  const { logger } = getServerContext();
  const sessionId = c.req.query('sessionId') ?? 'default';
  const projectId = c.req.query('projectId') ?? 'default';

  try {
    const tracker = ProgressTracker.default(sessionId, projectId);
    const markdown = tracker.toMarkdown();
    const compact = tracker.toCompact();

    return c.json({
      sessionId,
      projectId,
      stats: tracker.stats,
      percent: tracker.percent,
      tasks: tracker.tasks,
      nextTask: tracker.nextTask,
      readyTasks: tracker.readyTasks,
      notes: tracker.notes.slice(-10),
      markdown,
      compact,
    });
  } catch (e) {
    logger.error('Failed to read progress', { error: String(e) });
    return c.json({ error: (e as Error).message }, 500);
  }
});

const updateSchema = z.object({
  sessionId: z.string().default('default'),
  projectId: z.string().default('default'),
  action: z.enum(['add', 'update', 'note']),
  task: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'cancelled']).optional(),
      dependencies: z.array(z.string()).optional(),
    })
    .optional(),
  note: z.string().optional(),
});

// POST /api/progress — update progress
progressRouter.post('/', async (c) => {
  const { logger } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const { sessionId, projectId, action, task, note } = parsed.data;

  try {
    const tracker = ProgressTracker.default(sessionId, projectId);

    if (action === 'add' && task?.title) {
      tracker.addTask({
        id: task.id ?? `task_${Date.now()}`,
        title: task.title,
        description: task.description,
        dependencies: task.dependencies,
      });
      tracker.save();
      return c.json({ status: 'added', task: tracker.getTask(task.id ?? '') });
    }

    if (action === 'update' && task?.id && task?.status) {
      const updated = tracker.updateStatus(task.id, task.status);
      if (!updated) return c.json({ error: 'Task not found' }, 404);
      tracker.save();
      return c.json({ status: 'updated', task: updated });
    }

    if (action === 'note' && note) {
      tracker.addNote(note);
      tracker.save();
      return c.json({ status: 'noted' });
    }

    return c.json({ error: 'Invalid action' }, 400);
  } catch (e) {
    logger.error('Failed to update progress', { error: String(e) });
    return c.json({ error: (e as Error).message }, 500);
  }
});
