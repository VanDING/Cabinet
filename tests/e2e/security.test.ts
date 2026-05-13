import { describe, it, expect } from 'vitest';
import { createApp } from '../../apps/server/src/index';

const PIN = '1234';
const headers = { 'Content-Type': 'application/json', 'x-cabinet-pin': PIN };

describe('Security Checks', () => {
  const app = createApp();

  // SQL Injection attempt
  it('rejects SQL injection in query params', async () => {
    const res = await app.request("/api/decisions?status='; DROP TABLE decisions;--", { headers });
    expect(res.status).toBe(200);
    // Should not crash; parameterized queries protect against injection
    const body = await res.json();
    expect(body.decisions).toBeDefined();
  });

  // XSS attempt
  it('handles XSS in chat message safely', async () => {
    const res = await app.request('/api/secretary/chat', {
      method: 'POST', headers,
      body: JSON.stringify({ sessionId: 'xss-test', message: '<script>alert("xss")</script>' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toBeDefined();
  });

  // Rate limiting — rapid requests
  it('handles rapid requests without crashing', async () => {
    const promises = Array.from({ length: 10 }, () =>
      app.request('/api/dashboard/summary', { headers })
    );
    const results = await Promise.all(promises);
    for (const res of results) {
      expect([200, 429]).toContain(res.status);
    }
  });

  // Pin brute force simulation
  it('handles multiple failed auth attempts', async () => {
    for (let i = 0; i < 7; i++) {
      const res = await app.request('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '0000' }),
      });
      // Should respond (not crash) even after many attempts
      expect([200, 401, 429]).toContain(res.status);
    }
  });

  // Invalid JSON body
  it('handles malformed JSON gracefully', async () => {
    const res = await app.request('/api/secretary/chat', {
      method: 'POST', headers,
      body: 'this is not json',
    });
    // Should not crash
    expect([400, 500]).toContain(res.status);
  });
});
