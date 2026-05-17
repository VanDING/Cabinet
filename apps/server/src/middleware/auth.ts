import type { Context, Next } from 'hono';

const PUBLIC_PATHS = ['/health', '/api/auth/verify', '/api/openapi.json', '/api/docs'];

export async function authMiddleware(c: Context, next: Next) {
  if (PUBLIC_PATHS.some((p) => c.req.path.startsWith(p))) return next();

  // Cabinet is a local desktop application — localhost requests bypass auth
  const host = c.req.header('host') ?? '';
  if (
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('[::1]') ||
    host === ''
  ) {
    return next();
  }

  // Remote requests must provide a PIN
  const pin = c.req.header('x-cabinet-pin');
  if (!pin || pin.length < 4) {
    return c.json({ error: 'Unauthorized — provide x-cabinet-pin header' }, 401);
  }

  await next();
}
