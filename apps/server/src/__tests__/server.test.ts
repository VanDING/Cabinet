import { describe, it, expect } from 'vitest';
import { createApp } from '../index';

describe('Server API', () => {
  const app = createApp();

  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
  });

  it('POST /api/auth/verify with valid PIN returns valid', async () => {
    const res = await app.request('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.valid).toBe(true);
  });

  it('GET /api/secretary/sessions returns empty list', async () => {
    const res = await app.request('/api/secretary/sessions', {
      headers: { 'x-cabinet-pin': '1234' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.sessions).toEqual([]);
  });

  it('returns 401 without auth header on protected routes', async () => {
    const res = await app.request('/api/decisions');
    expect(res.status).toBe(401);
  });

  it('POST /api/secretary/chat validates input', async () => {
    const res = await app.request('/api/secretary/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
      body: JSON.stringify({ sessionId: 's1' }), // missing message
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/dashboard/summary returns stats', async () => {
    const res = await app.request('/api/dashboard/summary', {
      headers: { 'x-cabinet-pin': '1234' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('pendingDecisions');
    expect(body).toHaveProperty('todayCost');
  });
});
