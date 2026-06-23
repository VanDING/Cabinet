import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { runEvals, listDatasets } from '../mastra/evals/run.js';

const evalsRouter = new Hono();

evalsRouter.get('/datasets', (c) => {
  return c.json({ datasets: listDatasets() });
});

evalsRouter.post('/run', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { dataset, scorer } = body as { dataset?: string; scorer?: string };
  if (!dataset) return c.json({ error: 'dataset is required' }, 400);
  try {
    const result = await runEvals(dataset, scorer);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

evalsRouter.get('/results', (c) => {
  const { db, logger } = getServerContext();
  try {
    const rows = db
      .prepare('SELECT * FROM evaluation_results ORDER BY created_at DESC LIMIT 50')
      .all();
    return c.json({ results: rows });
  } catch (err) {
    logger?.warn('Failed to load eval results', { error: String(err) });
    return c.json({ results: [] });
  }
});

export { evalsRouter };
