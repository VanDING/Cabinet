import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

const evaluationsRouter = new Hono();

let lastQualityAlertTime = 0;
const QUALITY_ALERT_COOLDOWN = 600_000;

evaluationsRouter.get('/', (c) => {
  const { db, logger } = getServerContext();
  try {
    const rows = db
      .prepare('SELECT * FROM evaluation_results ORDER BY created_at DESC LIMIT 50')
      .all() as Array<Record<string, unknown>>;
    return c.json({ evaluations: rows });
  } catch (err) {
    logger.warn('Failed to load evaluations', { error: String(err) });
    return c.json({ evaluations: [] });
  }
});

evaluationsRouter.get('/summary', (c) => {
  const { db, logger } = getServerContext();
  try {
    const rows = db
      .prepare(
        `SELECT metric_name, COUNT(*) as count, AVG(score) as avg_score
       FROM evaluation_results
       GROUP BY metric_name`,
      )
      .all() as Array<{ metric_name: string; count: number; avg_score: number }>;
    for (const row of rows) {
      if (
        row.avg_score < 0.4 &&
        row.count >= 3 &&
        Date.now() - lastQualityAlertTime > QUALITY_ALERT_COOLDOWN
      ) {
        lastQualityAlertTime = Date.now();
        broadcast('quality_alert', {
          metric: row.metric_name,
          avgScore: row.avg_score,
          sampleCount: row.count,
        });
      }
    }
    return c.json({ summary: rows });
  } catch (err) {
    logger.warn('Failed to load evaluation summary', { error: String(err) });
    return c.json({ summary: [] });
  }
});

export { evaluationsRouter };
