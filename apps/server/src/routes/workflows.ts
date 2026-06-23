import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

const workflowRouter = new Hono();

workflowRouter.post('/:workflowId/runs/:runId/resume', async (c) => {
  const { mastra, decisionService, logger } = getServerContext();
  const workflowId = c.req.param('workflowId');
  const runId = c.req.param('runId');
  const body = await c.req.json().catch(() => ({}));

  if (!mastra) return c.json({ error: 'Mastra not initialized' }, 503);

  try {
    const wf = mastra.getWorkflow(workflowId);
    if (!wf) return c.json({ error: 'Workflow not found' }, 404);

    const result = await (wf as any).resumeAsync({ runId, resumeData: body });
    broadcast('workflow_completed', { workflowId, runId, status: 'resumed' });
    logger.info('Workflow resumed', { workflowId, runId });
    return c.json({ status: 'resumed', result });
  } catch (err) {
    logger.error('Failed to resume workflow', { workflowId, runId, error: String(err) });
    return c.json({ error: String(err) }, 500);
  }
});

workflowRouter.get('/:workflowId/runs', (c) => {
  const { db } = getServerContext();
  const workflowId = c.req.param('workflowId');
  try {
    const runs = db
      .prepare(
        'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20',
      )
      .all(workflowId);
    return c.json({ runs });
  } catch {
    return c.json({ runs: [] });
  }
});

export { workflowRouter };
