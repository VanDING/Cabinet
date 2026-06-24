import type { Context, Next } from 'hono';

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
  const origin = c.req.header('origin');
  if (!isLocalOrigin(origin)) {
    return c.json({ error: 'Unauthorized origin' }, 403);
  }
  await next();
}
