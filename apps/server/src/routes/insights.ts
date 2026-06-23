import { Hono } from 'hono';

const insightsRouter = new Hono();

insightsRouter.get('/', (c) => {
  // TODO: Read from Mastra Observability storage when API is confirmed.
  // The old entity_memory table was never created, so return empty stub.
  return c.json({ insights: [] });
});

export { insightsRouter };
