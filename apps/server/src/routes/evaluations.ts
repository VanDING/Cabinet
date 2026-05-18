import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const evaluationsRouter = new Hono();

// GET /api/evaluations?projectId=...&limit=50
evaluationsRouter.get('/', (c) => {
  const ctx = getServerContext();
  const projectId = c.req.query('projectId') ?? 'default';
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  try {
    const rows = ctx.db
      .prepare(
        `SELECT * FROM evaluation_results WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, limit) as any[];

    return c.json({
      evaluations: rows.map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        sessionId: r.session_id,
        sourceType: r.source_type,
        sourceId: r.source_id,
        overallScore: r.overall_score,
        dimensions: JSON.parse(r.dimensions ?? '{}'),
        feedback: r.feedback,
        evaluatorModel: r.evaluator_model,
        createdAt: r.created_at,
      })),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/evaluations/summary?projectId=...
evaluationsRouter.get('/summary', (c) => {
  const ctx = getServerContext();
  const projectId = c.req.query('projectId') ?? 'default';

  try {
    const stats = ctx.db
      .prepare(
        `SELECT COUNT(*) as total, AVG(overall_score) as avgScore, MAX(overall_score) as maxScore, MIN(overall_score) as minScore
         FROM evaluation_results WHERE project_id = ?`,
      )
      .get(projectId) as any;

    return c.json({
      total: stats.total ?? 0,
      avgScore: stats.avgScore ? Math.round(stats.avgScore * 100) / 100 : 0,
      maxScore: stats.maxScore ?? 0,
      minScore: stats.minScore ?? 0,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
