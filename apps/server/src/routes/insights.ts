import { Hono } from 'hono';
import { getServerContext } from '../context.js';

const insightsRouter = new Hono();

insightsRouter.get('/', (c) => {
  const { db, logger } = getServerContext();
  try {
    const insights: Array<Record<string, unknown>> = [];
    try {
      const rows = db
        .prepare(
          `SELECT id, source, content, created_at
         FROM entity_memory
         WHERE source = 'insight'
         ORDER BY created_at DESC
         LIMIT 20`,
        )
        .all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        insights.push({
          id: row.id,
          source: 'observational',
          content: (row.content as string) ?? '',
          createdAt: row.created_at,
        });
      }
    } catch {
      /* table may not exist */
    }
    return c.json({ insights });
  } catch (err) {
    logger.warn('Failed to load insights', { error: String(err) });
    return c.json({ insights: [] });
  }
});

export { insightsRouter };
