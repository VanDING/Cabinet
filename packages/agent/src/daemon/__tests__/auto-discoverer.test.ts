import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoDiscoverer } from '../auto-discoverer.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn() }));
vi.mock('node:path', () => {
  const path = { join: (...args: string[]) => args.join('/').replace(/\\/g, '/') };
  return { ...path, default: path };
});
vi.mock('@cabinet/storage', () => ({ CABINET_DIR: '/mock/cabinet' }));

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';

function createMockProcess(exitCode: number | null = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = { on: vi.fn(), pipe: vi.fn() };
  proc.stderr = { on: vi.fn(), pipe: vi.fn() };
  proc.stdin = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  process.nextTick(() => proc.emit('close', exitCode));
  return proc;
}

describe('AutoDiscoverer', () => {
  let registry: { registerExternalAgent: ReturnType<typeof vi.fn> };
  let discoverer: AutoDiscoverer;

  beforeEach(() => {
    registry = { registerExternalAgent: vi.fn().mockReturnValue(true) };
    discoverer = new AutoDiscoverer(registry as any);
    vi.clearAllMocks();
  });

  describe('discover()', () => {
    it('returns an array of discovery results', async () => {
      (spawn as any).mockImplementation(() => createMockProcess(1));
      (existsSync as any).mockReturnValue(false);

      const results = await discoverer.discover();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('registers CLI agents found on PATH', async () => {
      (spawn as any).mockImplementation(() => createMockProcess(0));
      (existsSync as any).mockReturnValue(false);

      await discoverer.discover();

      expect(registry.registerExternalAgent).toHaveBeenCalled();
      const call = registry.registerExternalAgent.mock.calls[0][0];
      expect(call.protocol).toBe('cli');
      expect(call.name).toMatch(/^external_cli:/);
    });

    it('does not register undetected CLI agents', async () => {
      (spawn as any).mockImplementation(() => createMockProcess(1));
      (existsSync as any).mockReturnValue(false);

      await discoverer.discover();
      expect(registry.registerExternalAgent).not.toHaveBeenCalled();
    });

    it('registers A2A agents from agent directory', async () => {
      (spawn as any).mockImplementation(() => createMockProcess(1));
      (existsSync as any).mockImplementation((p: string) => p.includes('/agents'));
      (readdirSync as any).mockReturnValue([{ name: 'my-agent', isDirectory: () => true }]);
      (readFileSync as any).mockReturnValue(
        JSON.stringify({
          name: 'my-agent',
          display_name: 'My Agent',
          description: 'Test A2A agent',
          connection: { base_url: 'http://localhost:4000' },
          systemPrompt: 'You are a test agent.',
        }),
      );

      await discoverer.discover();

      expect(registry.registerExternalAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          protocol: 'a2a',
          name: 'external_a2a:my-agent',
          baseUrl: 'http://localhost:4000',
        }),
      );
    });

    it('skips files in agent directory (only scans directories)', async () => {
      (spawn as any).mockImplementation(() => createMockProcess(1));
      (existsSync as any).mockImplementation(() => true);
      (readdirSync as any).mockReturnValue([{ name: 'notes.txt', isDirectory: () => false }]);

      await discoverer.discover();
      expect(registry.registerExternalAgent).not.toHaveBeenCalled();
    });

    it('includes error result for invalid agent.json', async () => {
      (spawn as any).mockImplementation(() => createMockProcess(1));
      (existsSync as any).mockImplementation((p: string) => p.includes('/agents'));
      (readdirSync as any).mockReturnValue([{ name: 'bad', isDirectory: () => true }]);
      (readFileSync as any).mockReturnValue('invalid json');

      const results = await discoverer.discover();
      const bad = results.find((r) => r.protocol === 'a2a' && !r.detected);
      expect(bad).toBeDefined();
      expect(bad!.error).toContain('Invalid agent.json');
    });
  });

  describe('getLastResults()', () => {
    it('returns empty array before discover()', () => {
      expect(discoverer.getLastResults()).toEqual([]);
    });

    it('caches results after discover()', async () => {
      (spawn as any).mockImplementation(() => createMockProcess(1));
      (existsSync as any).mockReturnValue(false);

      const results = await discoverer.discover();
      expect(discoverer.getLastResults()).toBe(results);
    });
  });
});
