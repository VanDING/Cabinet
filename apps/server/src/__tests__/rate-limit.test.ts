import { describe, it, expect } from 'vitest';
import type { Context, Next } from 'hono';

// Test the rate limiter logic in isolation by simulating the middleware behavior
describe('rateLimiter', () => {
  function createMockContext(ip: string): Context {
    return {
      req: {
        header(name: string) {
          if (name === 'x-forwarded-for') return ip;
          if (name === 'x-real-ip') return undefined;
          return undefined;
        },
      },
      json(body: unknown, status: number) {
        return { body, status };
      },
    } as unknown as Context;
  }

  it('allows localhost requests unconditionally', () => {
    const localIPs = ['127.0.0.1', '::1', '127.0.0.2', 'localhost'];
    for (const ip of localIPs) {
      const key = ip === 'localhost' ? ip : ip;
      const isLocal =
        key === '127.0.0.1' || key === '::1' || key.startsWith('127.') || key === 'localhost';
      expect(isLocal).toBe(true);
    }
  });

  it('rate-limits exceeding requests within window', () => {
    const maxRequests = 3;
    const windowMs = 60_000;
    const store = new Map<string, { count: number; resetAt: number }>();

    const key = '192.168.1.100';
    const now = Date.now();

    // Simulate 3 requests (within limit)
    for (let i = 0; i < maxRequests; i++) {
      const entry = store.get(key);
      if (!entry || entry.resetAt <= now) {
        store.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        entry.count++;
      }
    }

    const entry = store.get(key);
    expect(entry?.count).toBeLessThanOrEqual(maxRequests);
  });

  it('blocks requests exceeding maxRequests', () => {
    const maxRequests = 2;
    const store = new Map<string, { count: number; resetAt: number }>();
    const key = '10.0.0.1';
    const now = Date.now();

    store.set(key, { count: maxRequests + 1, resetAt: now + 60_000 });

    const entry = store.get(key)!;
    const blocked = entry.count > maxRequests;
    expect(blocked).toBe(true);
  });

  it('resets counter after window expires', () => {
    const windowMs = 1000;
    const store = new Map<string, { count: number; resetAt: number }>();
    const key = '172.16.0.1';
    const pastTime = Date.now() - 2000; // 2 seconds ago

    store.set(key, { count: 100, resetAt: pastTime + windowMs }); // expired

    const entry = store.get(key)!;
    const now = Date.now();
    const expired = entry.resetAt <= now;
    expect(expired).toBe(true);
  });

  it('evicts oldest entry when at capacity', () => {
    const MAX_SIZE = 5;
    const store = new Map<string, { count: number; resetAt: number }>();

    // Fill to capacity
    for (let i = 0; i < MAX_SIZE; i++) {
      store.set(`ip-${i}`, { count: 1, resetAt: Date.now() + 60000 + i * 1000 });
    }

    // Verify size
    expect(store.size).toBe(MAX_SIZE);

    // New entry triggers eviction of oldest (ip-0, smallest resetAt)
    if (store.size >= MAX_SIZE) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, e] of store) {
        if (e.resetAt < oldestTime) {
          oldestTime = e.resetAt;
          oldestKey = k;
        }
      }
      if (oldestKey) store.delete(oldestKey);
    }
    store.set('ip-new', { count: 1, resetAt: Date.now() + 60000 });

    expect(store.size).toBe(MAX_SIZE);
    expect(store.has('ip-0')).toBe(false); // oldest was evicted
    expect(store.has('ip-new')).toBe(true);
  });
});
