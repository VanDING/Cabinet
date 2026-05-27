import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

export const deliverablesRouter = new Hono();

// GET /api/deliverables — global aggregation (office homepage)
deliverablesRouter.get('/', (c) => {
  const ctx = getServerContext();

  try {
    const rows = ctx.db
      .prepare(
        `SELECT id, project_id, meeting_id, title, type, file_path, tags, created_at
         FROM project_deliverables
         ORDER BY created_at DESC
         LIMIT 50`,
      )
      .all() as any[];

    return c.json({
      deliverables: rows.map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        meetingId: r.meeting_id,
        title: r.title,
        type: r.type,
        filePath: r.file_path,
        tags: JSON.parse(r.tags ?? '[]'),
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /:id/deliverables  (mounted at /api/projects)
deliverablesRouter.get('/:id/deliverables', (c) => {
  const projectId = c.req.param('id');
  const ctx = getServerContext();

  try {
    const rows = ctx.db
      .prepare(
        `SELECT id, project_id, meeting_id, title, type, file_path, tags, created_at
         FROM project_deliverables
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(projectId) as any[];

    return c.json({
      deliverables: rows.map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        meetingId: r.meeting_id,
        title: r.title,
        type: r.type,
        filePath: r.file_path,
        tags: JSON.parse(r.tags ?? '[]'),
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /:id/deliverables — create a deliverable
deliverablesRouter.post('/:id/deliverables', async (c) => {
  const projectId = c.req.param('id');
  const ctx = getServerContext();

  try {
    const body = await c.req.json();
    const { title, type, meetingId, filePath, tags } = body as {
      title?: string;
      type?: string;
      meetingId?: string;
      filePath?: string;
      tags?: string[];
    };

    if (!title) return c.json({ error: 'title is required' }, 400);

    const id = `d_${Date.now()}`;
    ctx.db
      .prepare(
        `INSERT INTO project_deliverables (id, project_id, meeting_id, title, type, file_path, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        meetingId ?? null,
        title,
        type ?? 'general',
        filePath ?? null,
        JSON.stringify(tags ?? []),
      );

    ctx.logger.info('Deliverable created', { id, projectId, title });
    broadcast('deliverable_created', {
      id,
      projectId,
      title,
      type: type ?? 'general',
      timestamp: new Date().toISOString(),
    });
    return c.json({ created: true, id, title, type: type ?? 'general' }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// DELETE /:id/deliverables/:deliverableId
deliverablesRouter.delete('/:id/deliverables/:deliverableId', (c) => {
  const projectId = c.req.param('id');
  const deliverableId = c.req.param('deliverableId');
  const ctx = getServerContext();

  try {
    ctx.db
      .prepare('DELETE FROM project_deliverables WHERE id = ? AND project_id = ?')
      .run(deliverableId, projectId);
    return c.json({ deleted: true, id: deliverableId });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
