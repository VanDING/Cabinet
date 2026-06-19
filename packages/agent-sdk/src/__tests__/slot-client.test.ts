import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlotClient } from '../slot-client.js';

describe('SlotClient', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new SlotClient({
    baseUrl: 'http://localhost:3000',
    taskToken: 'task_test_abc123',
    taskId: 'task-1',
    agentId: 'agent-1',
  });

  it('reads slot with auth headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          version: 1,
          project: { name: 'test', goals: [] },
          preferences: {},
          memories: [],
          files: [],
          discoveries: [],
          previous_outputs: [],
          security: { level: 'L1', maxRetries: 2 },
        }),
    });

    const slot = await client.readSlot();
    expect(slot.project.name).toBe('test');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/slot/task-1/read',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer task_test_abc123',
        }),
      }),
    );
  });

  it('writes discoveries', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await client.writeDiscoveries([{ type: 'code_analysis', summary: 'Found bug in main.rs' }]);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/slot/task-1/write',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('code_analysis'),
      }),
    );
  });

  it('submits deliverables and returns ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ deliverable_id: 'd_123' }),
    });

    const id = await client.submitDeliverable('My output', 'code content', 'code');
    expect(id).toBe('d_123');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/external/deliverables',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requests decisions with correct schema', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ decision_id: 'dec_123', status: 'pending' }),
    });

    const result = await client.requestDecision({
      title: 'Should we deploy?',
      description: 'Tests passing',
      urgency: 'yellow',
      options: [
        { label: 'Deploy now', value: 'deploy' },
        { label: 'Wait', value: 'wait' },
      ],
    });
    expect(result.decision_id).toBe('dec_123');
  });

  it('reports telemetry', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await client.reportTelemetry('agent-1', {
      model: 'claude-3',
      tokens: { prompt: 100, completion: 50 },
      timing: { ttft_ms: 200, total_ms: 5000, tool_latency_ms: [100, 200] },
      steps: 5,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/telemetry/report',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(client.readSlot()).rejects.toThrow('SlotClient HTTP 401');
  });
});
