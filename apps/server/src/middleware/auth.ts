import type { Context, Next } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';

const PUBLIC_PATHS = ['/health', '/api/auth/verify', '/api/openapi.json', '/api/docs'];

// In production, store hashed PIN. For dev, use a simple hash.
const DEV_PIN_HASH = hashPin('1234');

function hashPin(pin: string): string {
  return createHash('sha256').update(pin + 'cabinet-salt').digest('hex');
}

function verifyPin(input: string, storedHash: string): boolean {
  const inputHash = hashPin(input);
  try {
    return timingSafeEqual(Buffer.from(inputHash), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  if (PUBLIC_PATHS.some(p => c.req.path.startsWith(p))) return next();
  const pin = c.req.header('x-cabinet-pin');
  if (!pin || !verifyPin(pin, DEV_PIN_HASH)) {
    return c.json({ error: 'Unauthorized: invalid or missing PIN' }, 401);
  }
  await next();
}
