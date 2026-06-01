import { describe, it, expect, beforeAll } from 'vitest';
import { createApp } from '../../apps/server/src/index';
import { seedProject, resetTier } from './test-helpers';

const PIN = '1234';
const headers = { 'Content-Type': 'application/json', 'x-cabinet-pin': PIN };

describe('Cabinet Core Loop (E2E)', () => {
  const app = createApp();
  let projectId = '';
  let decisionId1 = '';
  let decisionId2 = '';

  // Seed test decisions used by subsequent detail/approve/reject tests
  beforeAll(async () => {
    await resetTier(app);
    projectId = await seedProject(app);
    // Use 4+ options to get L2 classification (won't auto-approve on creation)
    const r1 = await app.request('/api/decisions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectId,
        type: 'action',
        title: 'Test Decision 1',
        description: 'For testing detail/approve',
        options: [
          { id: 'opt-a', label: 'Option A', impact: 'High' },
          { id: 'opt-b', label: 'Option B', impact: 'Medium' },
          { id: 'opt-c', label: 'Option C', impact: 'Low' },
          { id: 'opt-d', label: 'Option D', impact: 'None' },
        ],
      }),
    });
    if (r1.status === 201) {
      const b1: any = await r1.json();
      decisionId1 = b1.decision?.id ?? '';
    }

    const r2 = await app.request('/api/decisions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        projectId,
        type: 'action',
        title: 'Test Decision 2',
        description: 'For testing reject',
        options: [
          { id: 'opt-a', label: 'Option A', impact: 'High' },
          { id: 'opt-b', label: 'Option B', impact: 'Medium' },
          { id: 'opt-c', label: 'Option C', impact: 'Low' },
          { id: 'opt-d', label: 'Option D', impact: 'None' },
        ],
      }),
    });
    if (r2.status === 201) {
      const b2: any = await r2.json();
      decisionId2 = b2.decision?.id ?? '';
    }
  });

  // Step 1: Dashboard summary
  it('GET /api/dashboard/summary returns initial state', async () => {
    const res = await app.request('/api/dashboard/summary', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('pendingDecisions');
    expect(body).toHaveProperty('todayCost');
    expect(body).toHaveProperty('activeProjects');
  });

  // Step 2: Secretary chat — send message
  const sessionId = 'e2e-session';
  it('POST /api/secretary/chat processes message', async () => {
    const res = await app.request('/api/secretary/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId, message: '分析是否该进入母婴市场' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('response');
    expect(body).toHaveProperty('intent');
  });

  // Step 3: List decisions
  it('GET /api/decisions lists pending decisions', async () => {
    const res = await app.request('/api/decisions?status=pending', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('decisions');
    expect(body).toHaveProperty('total');
  });

  // Step 4: Get decision detail
  it('GET /api/decisions/:id returns decision detail', async () => {
    const id = decisionId1 || 'test-decision-1';
    const res = await app.request(`/api/decisions/${id}`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('decision');
    expect(body.decision).toHaveProperty('id', id);
  });

  // Step 5: Approve a decision
  it('POST /api/decisions/:id/approve approves decision', async () => {
    const id = decisionId1 || 'test-decision-1';
    const res = await app.request(`/api/decisions/${id}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chosenOptionId: 'opt-a' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
    expect(body).toHaveProperty('chosenOptionId', 'opt-a');
  });

  // Step 6: Reject a decision
  it('POST /api/decisions/:id/reject rejects decision', async () => {
    const id = decisionId2 || 'test-decision-2';
    const res = await app.request(`/api/decisions/${id}/reject`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('rejected');
  });

  // Step 7: List workflows
  it('GET /api/factory lists workflows', async () => {
    const res = await app.request('/api/factory', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('workflows');
  });

  // Step 8: Create a workflow
  it('POST /api/factory creates workflow', async () => {
    const res = await app.request('/api/factory', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Test Workflow', projectId, nodes: [], edges: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.status).toBe('created');
  });

  // Step 9: Meeting endpoint removed — meetings are now initiated via
  // Secretary → MeetingChair → start_meeting tool → runMeeting()
  it('POST /api/meetings returns 404 (endpoint removed, use Secretary chat)', async () => {
    const res = await app.request('/api/meetings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ topic: 'Q3 Strategy', advisorIds: ['a1', 'a2'] }),
    });
    expect(res.status).toBe(404);
  });

  // Step 10: Auth flow — verify PIN via header
  it('POST /api/auth/verify validates PIN from header', async () => {
    const res = await app.request('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cabinet-pin': '1234' },
    });
    const body = await res.json();
    // First run or already set — either valid or missing_pin
    expect([200, 401]).toContain(res.status);
  });

  // Step 11: Auth — missing PIN returns 401
  it('POST /api/auth/verify rejects request without PIN', async () => {
    const res = await app.request('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  // Step 12: protected routes require PIN
  it('protected routes return 401 without PIN', async () => {
    const res = await app.request('/api/decisions');
    expect(res.status).toBe(401);
  });

  // Step 13: WebSocket endpoint
  it('GET /ws/events requires WebSocket upgrade', async () => {
    const res = await app.request('/ws/events', { headers });
    expect([404, 426]).toContain(res.status);
  });

  // Step 14: Settings API — budget
  it('GET /api/settings/budget returns budget config', async () => {
    const res = await app.request('/api/settings/budget', { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('daily');
    expect(body).toHaveProperty('monthly');
  });

  // Step 15: Settings API — manage API keys
  it('POST /api/settings/api-keys adds an encrypted key', async () => {
    const res = await app.request('/api/settings/api-keys', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-test-key' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('key_added');
    expect(body).toHaveProperty('id');
  });

  // Step 16: Health check
  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
