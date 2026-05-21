import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const meetingsRouter = new Hono();

// GET /api/meetings — list recent meetings, optionally filtered by project
meetingsRouter.get('/', (c) => {
  const ctx = getServerContext();
  const projectId = c.req.query('projectId');
  const limit = Math.min(Number(c.req.query('limit')) || 20, 100);

  let sql = `SELECT * FROM project_deliverables WHERE type = 'meeting_report'`;
  const params: string[] = [];

  if (projectId) {
    sql += ` AND project_id = ?`;
    params.push(projectId);
  }

  sql += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(String(limit));

  const rows = ctx.db.prepare(sql).all(...params) as Array<{
    id: string;
    project_id: string;
    meeting_id: string;
    title: string;
    type: string;
    tags: string;
    created_at: string;
  }>;

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
