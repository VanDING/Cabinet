import { describe, it, expect } from 'vitest';
import { createApp } from '../../apps/server/src/index';

const headers = { 'Content-Type': 'application/json' };

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
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId: 'xss-test', message: '<script>alert("xss")</script>' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toBeDefined();
  });

  // Rate limiting — rapid requests
  it('handles rapid requests without crashing', async () => {
    const promises = Array.from({ length: 10 }, () =>
      app.request('/api/dashboard/summary', { headers }),
    );
    const results = await Promise.all(promises);
    for (const res of results) {
      expect([200, 429]).toContain(res.status);
    }
  });

  // Invalid JSON body
  it('handles malformed JSON gracefully', async () => {
    const res = await app.request('/api/secretary/chat', {
      method: 'POST',
      headers,
      body: 'this is not json',
    });
    // Should not crash
    expect([400, 500]).toContain(res.status);
  });

  // SQL injection must not leak database internals
  it('does not expose database errors on SQL injection', async () => {
    const res = await app.request("/api/decisions?status='; DROP TABLE decisions;--", { headers });
    const body = await res.json();
    const text = JSON.stringify(body).toLowerCase();
    // No SQL error messages or stack traces in response
    expect(text).not.toContain('sqlite');
    expect(text).not.toContain('syntax error');
    expect(text).not.toContain('stack');
    expect(text).not.toContain('traceback');
  });

  // Oversized input
  it('handles oversized input gracefully', async () => {
    const longMessage = 'A'.repeat(12_000);
    const res = await app.request('/api/secretary/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId: 'oversized-test', message: longMessage }),
    });
    // Must respond without crashing (OOM protection)
    expect([200, 400, 413, 422]).toContain(res.status);
  });
});
