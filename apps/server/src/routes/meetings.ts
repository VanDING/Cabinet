import { Hono } from 'hono';
import { broadcast } from '../ws/handler.js';

export const meetingsRouter = new Hono();

meetingsRouter.post('/', async (c) => {
  const body = await c.req.json();
  const meetingId = `meeting_${Date.now()}`;
  broadcast('meeting_created', { meetingId, topic: body.topic, estimatedCost: 0.35 });
  return c.json({ meetingId, status: 'started', estimatedCost: 0.35 });
});

meetingsRouter.get('/:id/status', (c) => {
  return c.json({ meetingId: c.req.param('id'), status: 'completed', actualCost: 0.32 });
});
