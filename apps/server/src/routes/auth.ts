import { Hono } from 'hono';
import { z } from 'zod';
export const authRouter = new Hono();

const verifySchema = z.object({ pin: z.string().min(4).max(8) });

authRouter.post('/verify', async (c) => {
  const body = await c.req.json();
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid PIN format' }, 400);
  // In production: hash and compare against stored PIN
  return c.json({ valid: true });
});

authRouter.put('/pin', async (c) => {
  return c.json({ status: 'pin_updated' });
});
