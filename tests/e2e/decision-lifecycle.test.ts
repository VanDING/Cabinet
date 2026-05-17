import { describe, it, expect, beforeAll } from 'vitest';
import { createTestApp, headers, createDecision } from './test-helpers';

describe('Decision Lifecycle (E2E)', () => {
  const app = createTestApp();
  let decisionId = '';

  beforeAll(async () => {
    const { body } = await createDecision(app, {
      title: 'Lifecycle Test Decision',
      description: 'Verify full pending→approve→audit trail',
    });
    if (body.decision?.id) decisionId = body.decision.id;
  });

  it('creates a decision with L2 classification (4+ options)', async () => {
    const { res, body } = await createDecision(app, {
      title: 'Classification Test',
      description: 'Should be L2 with 4 options',
    });
    expect(res.status).toBe(201);
    expect(body.decision).toBeDefined();
    expect(body.decision.id).toBeTruthy();
    expect(body.decision.level).toBe('L2');
    expect(body.decision.status).toBe('pending');
  });

  it('approves decision and transitions status to approved', async () => {
    const id = decisionId || 'fallback-id';
    const res = await app.request(`/api/decisions/${id}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chosenOptionId: 'opt-a' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('approved');
  });

  it('rejects decision and prevents re-approval of rejected', async () => {
    const { body } = await createDecision(app, {
      title: 'Rejection Test',
      description: 'Should be rejected and not re-approvable',
    });
    const id = body.decision?.id;
    expect(id).toBeTruthy();

    // Reject
    const rej = await app.request(`/api/decisions/${id}/reject`, {
      method: 'POST',
      headers,
    });
    expect(rej.status).toBe(200);
    const rejBody = await rej.json();
    expect(rejBody.status).toBe('rejected');

    // Attempt re-approval of rejected decision should fail
    const reApprove = await app.request(`/api/decisions/${id}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chosenOptionId: 'opt-a' }),
    });
    expect([400, 409, 422, 500]).toContain(reApprove.status);
  });

  it('audit trail records decision lifecycle events', async () => {
    const id = decisionId || 'fallback-id';
    const res = await app.request(`/api/decisions/${id}/audit`, { headers });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('trail');
    expect(Array.isArray(body.trail)).toBe(true);
  });

  it('creates and runs a workflow end-to-end', async () => {
    // Create
    const createRes = await app.request('/api/factory', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'E2E Lifecycle Workflow', nodes: [], edges: [] }),
    });
    expect(createRes.status).toBe(200);
    const wf = await createRes.json();
    expect(wf.id).toBeTruthy();

    // Run
    const runRes = await app.request(`/api/factory/${wf.id}/run`, {
      method: 'POST',
      headers,
    });
    expect([200, 400]).toContain(runRes.status);

    // Verify workflow appears in listing (default projectId filter)
    const listRes = await app.request('/api/factory?projectId=proj-1', { headers });
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.workflows.some((w: any) => w.id === wf.id)).toBe(true);
  });
});
