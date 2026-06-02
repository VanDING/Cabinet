import { describe, it, expect } from 'vitest';
import { createApp } from '../index';

describe('Server API', () => {
  const app = createApp();

  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
  });

  it('GET /api/projects returns ok (no PIN required)', async () => {
    const res = await app.request('/api/projects');
    expect(res.status).not.toBe(401); // origin check passes for test requests
  });
});
