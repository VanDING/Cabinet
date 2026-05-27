import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const scheduledTasksRouter = new Hono();

// GET /api/scheduled-tasks
scheduledTasksRouter.get('/', (c) => {
  const ctx = getServerContext();
  try {
    const tasks = ctx.taskScheduler.list();
    return c.json({ tasks });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/scheduled-tasks
scheduledTasksRouter.post('/', async (c) => {
  const ctx = getServerContext();
  try {
    const body = await c.req.json();
    const { name, cron, prompt, recurring } = body as {
      name?: string;
      cron?: string;
      prompt?: string;
      recurring?: boolean;
    };
    if (!name || !cron || !prompt) {
      return c.json({ error: 'name, cron, and prompt are required' }, 400);
    }
    const result = ctx.taskScheduler.schedule(name, cron, prompt, recurring ?? true);
    return c.json({ created: true, ...result }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// DELETE /api/scheduled-tasks/:id
scheduledTasksRouter.delete('/:id', (c) => {
  const ctx = getServerContext();
  const id = c.req.param('id');
  try {
    ctx.taskScheduler.cancel(id);
    return c.json({ cancelled: true, id });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/scheduled-tasks/:id/run — manual trigger
scheduledTasksRouter.post('/:id/run', async (c) => {
  const ctx = getServerContext();
  const id = c.req.param('id');
  try {
    const tasks = ctx.taskScheduler.list().filter((t) => t.id === id);
    if (tasks.length === 0) return c.json({ error: 'Task not found' }, 404);
    // Execute via gateway if available
    if (!ctx.gateway) return c.json({ error: 'No LLM gateway available' }, 503);
    const task = tasks[0]!;
    const testModel =
      (ctx.gateway as any).resolveModelString?.('fast_execution') ?? 'claude-haiku-4-5';
    const result = await ctx.gateway.generateText({
      model: testModel,
      systemPrompt: 'Execute this scheduled task. Be concise.',
      messages: [{ role: 'user', content: task.prompt }],
    });
    return c.json({ executed: true, id, preview: result.content.slice(0, 500) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
