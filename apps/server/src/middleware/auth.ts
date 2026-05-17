import type { Context, Next } from 'hono';

const PUBLIC_PATHS = ['/health', '/api/auth/verify', '/api/openapi.json', '/api/docs'];

export async function authMiddleware(c: Context, next: Next) {
  if (PUBLIC_PATHS.some((p) => c.req.path.startsWith(p))) return next();

  // Cabinet is a local desktop application — all local requests bypass auth
  await next();
}
