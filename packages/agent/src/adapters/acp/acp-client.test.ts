import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../utils/spawn.js', () => ({ isWindows: false, spawnCrossPlatform: vi.fn() }));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = { on: vi.fn(), setEncoding: vi.fn(), pipe: vi.fn() };
  proc.stderr = { on: vi.fn(), pipe: vi.fn() };
  proc.stdin = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  process.nextTick(() => proc.emit('close', 0));
  return proc;
}

describe('AcpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connects and sends initialize', async () => {
    (spawn as any).mockImplementation(() => createMockProcess());
    const { AcpClient } = await import('./acp-client.js');
    const client = new AcpClient('claude', []);
    const promise = client.connect();
    // Simulate response to initialize
    const onData = (spawn as any).mock.results[0]?.value.stdout.on;
    if (onData) {
      const dataCb = onData.mock.calls.find((c: unknown[]) => c[0] === 'data')?.[1];
      if (dataCb)
        process.nextTick(() =>
          dataCb(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }) + '\n'),
        );
    }
    await promise;
    expect(spawn).toHaveBeenCalledWith('claude', [], expect.anything());
  });

  it('newSession returns a session ID', async () => {
    (spawn as any).mockImplementation(() => createMockProcess());
    const { AcpClient } = await import('./acp-client.js');
    const client = new AcpClient('claude', []);
    const connectPromise = client.connect();
    const onData = (spawn as any).mock.results[0]?.value.stdout.on;
    if (onData) {
      const dataCb = onData.mock.calls.find((c: unknown[]) => c[0] === 'data')?.[1];
      if (dataCb)
        process.nextTick(() =>
          dataCb(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 1 } }) + '\n'),
        );
    }
    await connectPromise;

    const sessionPromise = client.newSession('/tmp');
    if (onData) {
      const dataCb = onData.mock.calls.find((c: unknown[]) => c[0] === 'data')?.[1];
      if (dataCb)
        process.nextTick(() =>
          dataCb(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { sessionId: 'sess_1' } }) + '\n'),
        );
    }
    const sid = await sessionPromise;
    expect(sid).toBe('sess_1');
  });
});
