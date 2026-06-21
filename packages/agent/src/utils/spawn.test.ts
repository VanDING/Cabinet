import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

function createMockProcess(exitCode: number | null = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = { on: vi.fn(), pipe: vi.fn() };
  proc.stderr = { on: vi.fn(), pipe: vi.fn() };
  proc.stdin = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  process.nextTick(() => proc.emit('close', exitCode));
  return proc;
}

describe('spawnCrossPlatform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds shell: true on Windows', async () => {
    const { spawnCrossPlatform } = await import('./spawn.js');
    (spawn as any).mockImplementation(() => createMockProcess(0));

    spawnCrossPlatform('echo', ['hi']);
    const callArgs = (spawn as any).mock.calls[0];
    expect(callArgs[0]).toBe('echo');
    expect(callArgs[1]).toEqual(['hi']);
    expect(callArgs[2]).toHaveProperty('shell');
  });

  it('merges user-provided options', async () => {
    const { spawnCrossPlatform } = await import('./spawn.js');
    (spawn as any).mockImplementation(() => createMockProcess(0));

    spawnCrossPlatform('claude', ['--version'], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const callArgs = (spawn as any).mock.calls[0];
    expect(callArgs[2].timeout).toBe(5000);
    expect(callArgs[2].stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });
});
