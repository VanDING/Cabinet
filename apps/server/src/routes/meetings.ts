import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const meetingsRouter = new Hono();

// GET /api/meetings — list recent meetings, optionally filtered by project
meetingsRouter.get('/', (c) => {
  const ctx = getServerContext();
  const projectId = c.req.query('projectId');
  const limit = Math.min(Number(c.req.query('limit')) || 20, 100);

  let rows = ctx.deliverableRepo.findByType('meeting_report', { limit: 1000 });

  if (projectId) {
    rows = rows.filter((r) => r.project_id === projectId);
  }

  rows = rows.slice(0, limit);

  const meetings = rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    meetingId: r.meeting_id,
    title: r.title,
    tags: JSON.parse(r.tags ?? '[]'),
    createdAt: r.created_at,
  }));

  return c.json({ meetings });
});
