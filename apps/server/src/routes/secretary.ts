import { Hono } from 'hono';
import { z } from 'zod';
export const secretaryRouter = new Hono();

const chatSchema = z.object({ sessionId: z.string(), message: z.string() });

secretaryRouter.post('/chat', async (c) => {
  const body = await c.req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  return c.json({
    sessionId: parsed.data.sessionId,
    response: `Echo: ${parsed.data.message}`,
    intent: { kind: 'unknown' },
  });
});

secretaryRouter.get('/sessions', (c) => c.json({ sessions: [] }));
