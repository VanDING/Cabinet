import type { Context, Next } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

const PUBLIC_PATHS = ['/health', '/api/auth/verify', '/api/openapi.json', '/api/docs'];
const SALT = 'cabinet-salt';

function hashPin(pin: string): string {
  return createHash('sha256').update(pin + SALT).digest('hex');
}

function verifyPin(input: string, storedHash: string): boolean {
  const inputHash = hashPin(input);
  try {
    return timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

/** Read stored PIN hash from DB. Returns null if not set (first run). */
function getStoredHash(db: Database.Database): string | null {
  try {
    const row = db.prepare(
      "SELECT value FROM metrics WHERE name = 'pin_hash' ORDER BY id DESC LIMIT 1"
    ).get() as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  // Public paths bypass auth
  if (PUBLIC_PATHS.some(p => c.req.path.startsWith(p))) return next();

  const pin = c.req.header('x-cabinet-pin');
  if (!pin) {
    return c.json({ error: 'Unauthorized: missing x-cabinet-pin header' }, 401);
  }

  // Get stored hash from DB (lazy — avoids circular import with getServerContext)
  const { getServerContext } = await import('../context.js');
  const { db, logger } = getServerContext();
  const storedHash = getStoredHash(db);

  // First run: no PIN set yet — allow any PIN through and store it
  if (!storedHash) {
    const newHash = hashPin(pin);
    db.prepare("INSERT INTO metrics (name, value, tags) VALUES ('pin_hash', ?, '{}')").run(newHash);
    logger.info('Initial PIN set (first run)');
    return next();
  }

  if (!verifyPin(pin, storedHash)) {
    return c.json({ error: 'Unauthorized: invalid PIN' }, 401);
  }

  await next();
}
