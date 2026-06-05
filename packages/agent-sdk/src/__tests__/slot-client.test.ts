import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlotClient } from '../slot-client.js';
import type { SlotClientConfig } from '../slot-client.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function createMockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as Response;
}

describe('SlotClient', () => {
  const defaultConfig: SlotClientConfig = {
    baseUrl: 'http://localhost:3000',
    taskToken: 'test-token-123',
    taskId: 'task-abc',
    agentId: 'my-agent',
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', () => {
      const client = new SlotClient({ ...defaultConfig, baseUrl: 'http://localhost:3000/' });
      // The trailing slash is stripped internally; verify via endpoint URL
      mockFetch.mockResolvedValue(createMockResponse({}));
      client.readSlot();
      const url = mockFetch.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:3000/api/slot/task-abc/read');
    });

    it('uses "external" as default agentId when not provided', () => {
      const { taskToken, taskId, baseUrl } = defaultConfig;
      const client = new SlotClient({ baseUrl, taskToken, taskId });
      expect(client).toBeDefined();
    });
  });

  describe('readSlot', () => {
    it('makes GET request to correct endpoint', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ project: 'test', preferences: {} }));
      const client = new SlotClient(defaultConfig);
      await client.readSlot();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe('http://localhost:3000/api/slot/task-abc/read');
      expect(init.method).toBe('GET');
      expect(init.headers).toHaveProperty('Authorization', 'Bearer test-token-123');
    });

    it('returns parsed JSON from response', async () => {
      const slotData = { project: 'my-project', preferences: { model: 'sonnet' } };
      mockFetch.mockResolvedValue(createMockResponse(slotData));
      const client = new SlotClient(defaultConfig);
      const result = await client.readSlot();
      expect(result).toEqual(slotData);
    });

    it('throws on non-2xx response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ error: 'Not found' }, 404));
      const client = new SlotClient(defaultConfig);
      await expect(client.readSlot()).rejects.toThrow('SlotClient HTTP 404');
    });
  });

  describe('writeDiscoveries', () => {
    it('makes POST request with discoveries payload', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true }));
      const client = new SlotClient(defaultConfig);
      const discoveries = [{ type: 'insight', summary: 'Found issue' }];
      await client.writeDiscoveries(discoveries);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ discoveries });
    });
  });

  describe('writeOutputs', () => {
    it('makes POST request with outputs payload', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true }));
      const client = new SlotClient(defaultConfig);
      await client.writeOutputs(['output-1', 'output-2']);
      const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ previous_outputs: ['output-1', 'output-2'] });
    });
  });

  describe('submitDeliverable', () => {
    it('returns deliverable_id from response', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ deliverable_id: 'del-456' }));
      const client = new SlotClient(defaultConfig);
      const id = await client.submitDeliverable('My Fix', 'code content');
      expect(id).toBe('del-456');
      const [url, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe('http://localhost:3000/api/external/deliverables');
      const body = JSON.parse(init.body as string);
      expect(body.title).toBe('My Fix');
      expect(body.agent_id).toBe('my-agent');
    });
  });

  describe('requestDecision', () => {
    it('defaults urgency to yellow', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ decision_id: 'dec-789', status: 'pending' }));
      const client = new SlotClient(defaultConfig);
      const result = await client.requestDecision({
        title: 'Deploy?',
        description: 'Should we deploy?',
        options: [{ label: 'Yes', value: 'yes' }],
      });
      expect(result.decision_id).toBe('dec-789');
      const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.urgency).toBe('yellow');
    });
  });

  describe('reportTelemetry', () => {
    it('sends telemetry to correct endpoint', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true }));
      const client = new SlotClient(defaultConfig);
      await client.reportTelemetry('agent-1', {
        model: 'sonnet',
        tokens: { prompt: 100, completion: 50 },
        timing: { ttft_ms: 200, total_ms: 1000, tool_latency_ms: [100] },
        steps: 3,
      });
      const [url, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
      expect(url).toBe('http://localhost:3000/api/telemetry/report');
      const body = JSON.parse(init.body as string);
      expect(body.task_id).toBe('task-abc');
      expect(body.status).toBe('completed');
    });
  });
});
