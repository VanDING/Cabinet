import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { memory as mastraMemory } from '../mastra/index.js';

const memoryRouter = new Hono();

memoryRouter.get('/', async (c) => {
  const { logger } = getServerContext();
  try {
    const threads = (await mastraMemory.listThreads({ perPage: 50 })) as any;
    const list = Array.isArray(threads) ? threads : (threads?.threads ?? threads?.data ?? []);
    return c.json({
      entries: list.map((t: any) => ({
        id: t.id,
        layer: 'thread',
        content: t.title ?? '',
        metadata: { resourceId: t.resourceId, createdAt: t.createdAt, updatedAt: t.updatedAt },
        timestamp: t.updatedAt ?? t.createdAt,
      })),
      total: list.length,
    });
  } catch (err) {
    logger.warn('Failed to list memory threads', { error: String(err) });
    return c.json({ entries: [], total: 0 });
  }
});

memoryRouter.delete('/:id', async (c) => {
  const { logger } = getServerContext();
  const id = c.req.param('id');
  try {
    await mastraMemory.deleteThread(id);
    broadcast('memory_changed', { action: 'deleted', id });
    return c.json({ status: 'deleted' });
  } catch (err) {
    logger.warn('Failed to delete memory thread', { error: String(err), id });
    return c.json({ error: 'Delete failed' }, 500);
  }
});

memoryRouter.get('/stats', (c) => {
  return c.json({
    status: 'active',
    type: 'mastra-observational-memory',
  });
});

export { memoryRouter };
