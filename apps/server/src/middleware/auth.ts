import type { Context, Next } from 'hono';

const PUBLIC_PATHS = ['/health', '/api/auth/verify'];

export async function authMiddleware(c: Context, next: Next) {
  if (PUBLIC_PATHS.some(p => c.req.path.startsWith(p))) {
    return next();
  }

  const pin = c.req.header('x-cabinet-pin');
  if (!pin) {
    return c.json({ error: 'Unauthorized: missing x-cabinet-pin header' }, 401);
  }

  // In production, verify PIN against stored hash
  await next();
}
