import { Hono } from 'hono';
export const workflowsRouter = new Hono();

workflowsRouter.get('/', (c) => c.json({ workflows: [] }));
workflowsRouter.post('/', async (c) => c.json({ id: `wf_${Date.now()}`, status: 'created' }));
workflowsRouter.put('/:id', async (c) => {
  const body = await c.req.json();
  return c.json({ id: c.req.param('id'), status: 'updated', ...body });
});
workflowsRouter.post('/:id/run', (c) => c.json({ runId: `run_${Date.now()}`, workflowId: c.req.param('id'), status: 'running' }));
workflowsRouter.get('/:id/runs', (c) => c.json({ runs: [] }));
