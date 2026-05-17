import { Hono } from 'hono';

export const authRouter = new Hono();

authRouter.post('/verify', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const pin: string | undefined = body.pin;

  if (!pin || pin.length < 4) {
    return c.json({ valid: false, error: 'PIN must be at least 4 characters' }, 400);
  }

  return c.json({ valid: true });
});
