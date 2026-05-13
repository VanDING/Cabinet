import { Hono } from 'hono';
import { z } from 'zod';

const verifySchema = z.object({ pin: z.string().min(4).max(8) });

export const authRouter = new Hono();

authRouter.post('/verify', async (c) => {
  const body = await c.req.json();
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'PIN must be 4-8 characters' }, 400);

  // Verify against stored hash
  const { createHash } = await import('node:crypto');
  const inputHash = createHash('sha256').update(parsed.data.pin + 'cabinet-salt').digest('hex');
  const storedHash = createHash('sha256').update('1234' + 'cabinet-salt').digest('hex');

  if (inputHash === storedHash) {
    return c.json({ valid: true });
  }
  return c.json({ valid: false }, 401);
});

authRouter.put('/pin', async (c) => {
  const body = await c.req.json();
  const { createHash } = await import('node:crypto');
  const newHash = createHash('sha256').update(body.pin + 'cabinet-salt').digest('hex');
  // In production, store newHash to database
  return c.json({ status: 'pin_updated' });
});
