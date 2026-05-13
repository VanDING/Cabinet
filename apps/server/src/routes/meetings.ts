import { Hono } from 'hono';
export const meetingsRouter = new Hono();

meetingsRouter.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({ meetingId: `meeting_${Date.now()}`, status: 'started', estimatedCost: 0.35 });
});

meetingsRouter.get('/:id/status', (c) => {
  return c.json({ meetingId: c.req.param('id'), status: 'completed', actualCost: 0.32 });
});
