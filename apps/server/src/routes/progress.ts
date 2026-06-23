import { Hono } from 'hono';
import { getServerContext } from '../context.js';

const progressRouter = new Hono();

progressRouter.get('/', (c) => {
  const { db, logger } = getServerContext();
  try {
    const runs = db
      .prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT 20')
      .all() as Array<Record<string, unknown>>;
    return c.json({ progress: runs });
  } catch (err) {
    logger.warn('Failed to load progress', { error: String(err) });
    return c.json({ progress: [] });
  }
});

progressRouter.post('/', async (c) => {
  const { mastra, logger } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const { workflowId, projectId } = body as { workflowId?: string; projectId?: string };
  if (!workflowId) return c.json({ error: 'workflowId is required' }, 400);

  if (!mastra) return c.json({ error: 'Mastra not initialized' }, 503);
  const wf = mastra.getWorkflow(workflowId);
  if (!wf) return c.json({ error: 'Workflow not found in Mastra' }, 404);

  try {
    const result = await wf.execute({ triggerData: {} } as any);
    logger.info('Workflow progress started', { workflowId, projectId, result });
    return c.json({ runId: (result as any)?.runId, status: 'started' });
  } catch (err) {
    logger.error('Workflow progress failed', { workflowId, error: String(err) });
    return c.json({ error: String(err) }, 500);
  }
});

export { progressRouter };
