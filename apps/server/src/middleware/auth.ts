import type { Context, Next } from 'hono';
import { getServerContext } from '../context.js';
import { verifyPin, getStoredHash, storePinHash } from '../auth-utils.js';

const PUBLIC_PATHS = ['/health', '/api/auth/verify', '/api/openapi.json', '/api/docs'];

/** Serializes first-run PIN initialization so concurrent requests don't race. */
let initLock: Promise<void> | null = null;

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname === 'tauri.localhost' ||
      url.protocol === 'tauri:' ||
      url.protocol === 'file:'
    );
  } catch {
    return false;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  if (PUBLIC_PATHS.some((p) => c.req.path.startsWith(p))) return next();

  // Layer 1: Restrict to local/Tauri origins
  const origin = c.req.header('origin') ?? c.req.header('referer');
  if (!isLocalOrigin(origin)) {
    return c.json({ error: 'Unauthorized origin' }, 403);
  }

  // Layer 2: PIN verification
  const pin = c.req.header('x-cabinet-pin');
  if (!pin) {
    return c.json({ error: 'PIN required' }, 401);
  }

  const { db } = getServerContext();
  const storedHash = getStoredHash(db);

  if (storedHash) {
    const result = await verifyPin(pin, storedHash);
    if (!result.valid) {
      return c.json({ error: 'Invalid PIN' }, 401);
    }
    if (result.needsRehash) {
      await storePinHash(db, pin);
    }
  } else {
    // First run: serialize initialization to prevent race conditions
    // when concurrent requests arrive before the PIN hash is stored.
    if (!initLock) {
      initLock = storePinHash(db, pin).finally(() => { initLock = null; });
    }
    await initLock;
  }

  await next();
}
