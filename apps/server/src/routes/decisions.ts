import { Hono } from 'hono';
import { broadcast } from '../ws/handler.js';

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
  const decisionId = c.req.param('id');
  broadcast('decision_updated', { decisionId, status: 'approved', chosenOptionId: body.chosenOptionId });
  return c.json({ decisionId, status: 'approved', chosenOptionId: body.chosenOptionId });
});

decisionsRouter.post('/:id/reject', async (c) => {
  const decisionId = c.req.param('id');
  broadcast('decision_updated', { decisionId, status: 'rejected' });
  return c.json({ decisionId, status: 'rejected' });
});
