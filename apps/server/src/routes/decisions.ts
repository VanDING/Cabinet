import { Hono } from 'hono';
export const decisionsRouter = new Hono();

decisionsRouter.get('/', (c) => {
  const status = c.req.query('status') ?? 'pending';
  return c.json({ decisions: [], status, total: 0 });
});

decisionsRouter.get('/:id', (c) => {
  return c.json({ decision: { id: c.req.param('id'), status: 'pending' } });
});

decisionsRouter.post('/:id/approve', async (c) => {
  const body = await c.req.json();
  return c.json({ decisionId: c.req.param('id'), status: 'approved', chosenOptionId: body.chosenOptionId });
});

decisionsRouter.post('/:id/reject', async (c) => {
  return c.json({ decisionId: c.req.param('id'), status: 'rejected' });
});
