import type { Context, Next } from 'hono';

const PUBLIC_PATHS = ['/health', '/api/auth/verify', '/api/openapi.json', '/api/docs'];

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Same-origin requests often omit Origin
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

  // Cabinet is a local desktop application — restrict to local/Tauri origins
  const origin = c.req.header('origin') ?? c.req.header('referer');
  if (!isLocalOrigin(origin)) {
    return c.json({ error: 'Unauthorized origin' }, 403);
  }

  await next();
}
