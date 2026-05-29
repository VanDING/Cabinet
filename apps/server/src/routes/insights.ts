import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const insightsRouter = new Hono();

insightsRouter.get('/', async (c) => {
  const { longTerm } = getServerContext();

  try {
    const entries = await longTerm.search('', 200);
    const insights = entries
      .filter((e) => e.metadata.type === 'insight')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .map((e) => ({
        id: e.id,
        text: e.content,
        relevance: (e.metadata.relevance as number) ?? 0,
        relatedEntities: (e.metadata.relatedEntities as string[]) ?? [],
        timestamp: e.timestamp.toISOString(),
      }));

    return c.json({ insights });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});
