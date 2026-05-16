import { Hono } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getServerContext } from '../context.js';

const SALT = 'cabinet-salt';
const DEFAULT_HASH = createHash('sha256').update('1234' + SALT).digest('hex');

function getPinHash(db: Database.Database): string {
  try {
    const row = db.prepare("SELECT value FROM metrics WHERE name = 'pin_hash' ORDER BY id DESC LIMIT 1").get() as { value: string } | undefined;
    return row?.value ?? DEFAULT_HASH;
  } catch (err) {
    // DB may not be ready — fall back to default hash
    return DEFAULT_HASH;
  }
}

export const authRouter = new Hono();

authRouter.post('/verify', async (c) => {
  const { db } = getServerContext();
  const body = await c.req.json();
  const pin = body.pin as string;
  if (!pin || pin.length < 4 || pin.length > 8) {
    return c.json({ valid: false, error: 'PIN must be 4-8 characters' }, 400);
  }
  const hash = createHash('sha256').update(pin + SALT).digest('hex');
  const valid = timingSafeEqual(Buffer.from(hash), Buffer.from(getPinHash(db)));
  return c.json({ valid }, valid ? 200 : 401);
});

authRouter.put('/pin', async (c) => {
  const { db, logger } = getServerContext();
  const body = await c.req.json();
  const pin = body.pin as string;
  if (!pin || pin.length < 4 || pin.length > 8) {
    return c.json({ error: 'PIN must be 4-8 characters' }, 400);
  }
  const hash = createHash('sha256').update(pin + SALT).digest('hex');
  db.prepare("INSERT INTO metrics (name, value, tags) VALUES ('pin_hash', ?, '{}')").run(hash);
  logger.info('PIN updated');
  return c.json({ status: 'pin_updated' });
});
