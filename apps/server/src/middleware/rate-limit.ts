import type { Context, Next } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function rateLimiter(maxRequests: number, windowMs: number) {
  const store = new Map<string, RateLimitEntry>();

  // Clean up expired entries every 60 seconds
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 60_000);
  if (typeof cleanup === 'object' && 'unref' in cleanup) cleanup.unref();

  return async function rateLimitMiddleware(c: Context, next: Next) {
    const key = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? '127.0.0.1';

    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return c.json(
        {
          error: 'Too many requests',
          retryAfter,
        },
        429,
      );
    }

    return next();
  };
}
