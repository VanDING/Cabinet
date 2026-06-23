import { Hono } from 'hono';
import { getServerContext } from '../context.js';

const telemetryRouter = new Hono();

telemetryRouter.get('/trends', (c) => {
  const { db, logger } = getServerContext();
  const days = parseInt(c.req.query('days') ?? '7', 10);
  try {
    const trends = db
      .prepare(
        `SELECT date(timestamp) as date,
              COUNT(*) as calls,
              SUM(prompt_tokens + completion_tokens) as tokens
       FROM cost_history
       WHERE timestamp >= date('now', ?)
       GROUP BY date(timestamp)
       ORDER BY date ASC`,
      )
      .all(`-${days} days`) as Array<{ date: string; calls: number; tokens: number }>;
    return c.json({ trends });
  } catch (err) {
    logger.warn('Failed to load telemetry trends', { error: String(err) });
    const empty: { date: string; calls: number; tokens: number }[] = [];
    return c.json({ trends: empty });
  }
});

export { telemetryRouter };
