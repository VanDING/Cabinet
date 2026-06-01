import { describe, it, expect } from 'vitest';
import { createApp } from '../index';

describe('Server API', () => {
  const app = createApp();

  it('GET /health returns ok (public)', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
  });

  it('POST /api/auth/verify requires PIN', async () => {
    const res = await app.request('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.valid).toBe(false);
  });

  it('protected routes require PIN (returns 401)', async () => {
    const res = await app.request('/api/secretary/sessions');
    expect(res.status).toBe(401);
  });

  it('protected POST routes require PIN (returns 401)', async () => {
    const res = await app.request('/api/secretary/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' }),
    });
    expect(res.status).toBe(401);
  });

  it('all protected routes enforce auth consistently', async () => {
    const routes = [
      '/api/decisions',
      '/api/dashboard/summary',
      '/api/projects',
      '/api/factory',
    ];
    for (const route of routes) {
      const res = await app.request(route);
      expect(res.status).toBe(401);
    }
  });
});
