import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { verifyPin, getStoredHash, storePinHash } from '../auth-utils.js';

export const authRouter = new Hono();

authRouter.post('/verify', async (c) => {
  const pin = c.req.header('x-cabinet-pin');
  if (!pin) return c.json({ valid: false, reason: 'missing_pin' }, 401);

  const { db } = getServerContext();
  const storedHash = getStoredHash(db);

  if (!storedHash) {
    await storePinHash(db, pin);
    return c.json({ valid: true, firstRun: true });
  }

  const result = await verifyPin(pin, storedHash);
  if (result.needsRehash) {
    await storePinHash(db, pin);
  }
  return c.json({ valid: result.valid });
});
