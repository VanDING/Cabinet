import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { bgTaskManager } from '../mastra/background-tasks.js';
import { mastra } from '../mastra/index.js';

const signalsRouter = new Hono();

signalsRouter.post('/decisions', async (c) => {
  const { logger } = getServerContext();
  const body = await c.req.json().catch(() => ({}));

  if (!body.title || !body.description) {
    return c.json({ error: 'title and description required' }, 400);
  }

  const agent = mastra.getAgent('secretary');
  try {
    const result = await agent.generate(`New external signal: ${body.title}\n${body.description}`, {
      memory: { thread: { id: body.threadId ?? `sig_${Date.now()}` } },
      maxSteps: 10,
    });
    const text = (result as { text?: string }).text ?? '';
    logger.info('Signal processed', { title: body.title });
    return c.json({ processed: true, response: text.slice(0, 200) });
  } catch (err) {
    logger.error('Signal processing failed', { error: String(err) });
    return c.json({ error: String(err) }, 500);
  }
});

signalsRouter.get('/tasks', async (c) => {
  const { logger } = getServerContext();
  try {
    const result = await bgTaskManager.listTasks({});
    return c.json(result);
  } catch (err) {
    logger.warn('Failed to list background tasks', { error: String(err) });
    return c.json({ tasks: [], total: 0 });
  }
});

signalsRouter.get('/tasks/:taskId', async (c) => {
  const { logger } = getServerContext();
  const taskId = c.req.param('taskId');
  try {
    const task = await bgTaskManager.getTask(taskId);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task);
  } catch (err) {
    logger.warn('Failed to get background task', { error: String(err), taskId });
    return c.json({ error: String(err) }, 500);
  }
});

signalsRouter.post('/tasks/:taskId/cancel', async (c) => {
  const { logger } = getServerContext();
  const taskId = c.req.param('taskId');
  try {
    await bgTaskManager.cancel(taskId);
    return c.json({ status: 'cancelled' });
  } catch (err) {
    logger.warn('Failed to cancel background task', { error: String(err), taskId });
    return c.json({ error: String(err) }, 500);
  }
});

signalsRouter.get('/tasks/stream', (c) => {
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const stream = bgTaskManager.stream({ abortSignal: c.req.raw.signal });
  return c.newResponse(stream);
});

export { signalsRouter };
