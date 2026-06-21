import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { GenericCliRuntime } from '../generic.js';

function mockProcess(exitCode: number | null = 0, stdoutText = '') {
  const proc = new EventEmitter() as any;
  proc.stdout = {
    on: vi.fn((_ev: string, cb: (c: Buffer) => void) => {
      if (stdoutText) setImmediate(() => cb(Buffer.from(stdoutText)));
    }),
    pipe: vi.fn(),
  };
  proc.stderr = { on: vi.fn(), pipe: vi.fn() };
  proc.stdin = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  setImmediate(() => proc.emit('close', exitCode));
  return proc;
}

describe('BaseCliRuntime detection (via GenericCliRuntime)', () => {
  let runtime: GenericCliRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new GenericCliRuntime('external_cli:test', {
      harnessId: 'generic',
      command: 'echo',
    });
  });

  it('detect() returns true on zero exit with version output', async () => {
    (spawn as any).mockImplementation(() => mockProcess(0, '1.0.0'));
    await expect(runtime.detect()).resolves.toBe(true);
  });

  it('detect() returns false on non-zero exit', async () => {
    (spawn as any).mockImplementation(() => mockProcess(1));
    await expect(runtime.detect()).resolves.toBe(false);
  });

  it('detect() returns false on spawn error', async () => {
    (spawn as any).mockImplementation(() => {
      const p = new EventEmitter() as any;
      p.stdout = { on: vi.fn(), pipe: vi.fn() };
      p.stderr = { on: vi.fn(), pipe: vi.fn() };
      p.stdin = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
      setImmediate(() => p.emit('error', new Error('ENOENT')));
      return p;
    });
    await expect(runtime.detect()).resolves.toBe(false);
  });
});
