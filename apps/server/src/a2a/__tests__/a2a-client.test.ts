import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2AClient } from '../a2a-client.js';
import type { Logger } from '@cabinet/storage';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe('A2AClient', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('creates an A2AClient instance', () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);
      expect(client).toBeInstanceOf(A2AClient);
    });
  });

  describe('discoverAgent', () => {
    it('fetches agent card from .well-known endpoint', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      const mockCard = {
        name: 'Test Agent',
        description: 'A test external agent',
        version: '1.0.0',
        capabilities: { streaming: true },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCard),
      });

      const result = await client.discoverAgent('https://agent.example.com');
      expect(result).toEqual(mockCard);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://agent.example.com/.well-known/agent-card.json',
      );
    });

    it('strips trailing slash from baseUrl', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'Agent', description: 'Desc', version: '1.0' }),
      });

      await client.discoverAgent('https://agent.example.com/');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://agent.example.com/.well-known/agent-card.json',
      );
    });

    it('returns null when response is not ok', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await client.discoverAgent('https://agent.example.com');
      expect(result).toBeNull();
    });

    it('returns null and logs warning on network error', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client.discoverAgent('https://offline.example.com');
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'A2A agent discovery failed',
        expect.objectContaining({ baseUrl: 'https://offline.example.com' }),
      );
    });
  });

  describe('sendMessage', () => {
    it('sends a task to the A2A v1.0 endpoint and polls for completion', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);
      const taskIdPattern = /\/a2a\/tasks\/(.+)$/;

      // First call: submit task — returns accepted
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'accepted' }),
      });
      // Second call: poll status — returns completed with output
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'completed', output: 'Hello from agent!' }),
      });

      const result = await client.sendMessage('https://agent.example.com', {
        role: 'user',
        content: 'Hello!',
      });

      expect(result).toBe('Hello from agent!');
      // First call should go to /a2a/tasks
      expect(mockFetch.mock.calls[0]![0]).toMatch(/https:\/\/agent\.example\.com\/a2a\/tasks$/);
      expect(mockFetch.mock.calls[0]![1]?.method).toBe('POST');
      // Second call should poll /a2a/tasks/{taskId}
      expect(mockFetch.mock.calls[1]![0]).toMatch(
        /https:\/\/agent\.example\.com\/a2a\/tasks\/task_\d+$/,
      );
    });

    it('throws on rejected task', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'rejected', error: 'too busy' }),
      });

      await expect(
        client.sendMessage('https://agent.example.com', { role: 'user', content: 'Hi' }),
      ).rejects.toThrow('A2A task rejected: too busy');
    });

    it('throws on non-ok response', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

      await expect(
        client.sendMessage('https://agent.example.com', { role: 'user', content: 'Hi' }),
      ).rejects.toThrow('A2A sendMessage failed: 503');
    });
  });

  describe('sendStreamingMessage', () => {
    it('returns ReadableStream on success', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      const mockBody = new ReadableStream<Uint8Array>();
      mockFetch.mockResolvedValueOnce({ ok: true, body: mockBody });

      const result = await client.sendStreamingMessage('https://agent.example.com', {
        role: 'user',
        content: 'Stream plz',
      });

      expect(result).toBe(mockBody);
    });

    it('returns null when response is not ok', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      mockFetch.mockResolvedValueOnce({ ok: false, body: null });

      const result = await client.sendStreamingMessage('https://agent.example.com', {
        role: 'user',
        content: 'Hi',
      });
      expect(result).toBeNull();
    });

    it('returns null when body is missing', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      mockFetch.mockResolvedValueOnce({ ok: true, body: null });

      const result = await client.sendStreamingMessage('https://agent.example.com', {
        role: 'user',
        content: 'Hi',
      });
      expect(result).toBeNull();
    });

    it('returns null and logs on network error', async () => {
      const logger = createMockLogger();
      const client = new A2AClient(logger);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await client.sendStreamingMessage('https://offline.example.com', {
        role: 'user',
        content: 'Hi',
      });
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'A2A streaming failed',
        expect.objectContaining({ agentUrl: 'https://offline.example.com' }),
      );
    });
  });
});
