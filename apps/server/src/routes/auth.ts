import { Hono } from 'hono';

export const authRouter = new Hono();

// Cabinet is a local desktop application — no remote auth needed.
authRouter.post('/verify', async (c) => {
  return c.json({ valid: true });
});
