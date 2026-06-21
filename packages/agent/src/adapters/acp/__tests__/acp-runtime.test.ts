import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAcpClient = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const newSession = vi.fn().mockResolvedValue('sess_1');
  const prompt = vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const onUpdate = vi.fn();
  return { connect, newSession, prompt, cancel, disconnect, onUpdate };
});

vi.mock('../acp-client.js', () => ({
  AcpClient: vi.fn(function (this: any) {
    this.connect = mockAcpClient.connect;
    this.newSession = mockAcpClient.newSession;
    this.prompt = mockAcpClient.prompt;
    this.cancel = mockAcpClient.cancel;
    this.disconnect = mockAcpClient.disconnect;
    this.onUpdate = mockAcpClient.onUpdate;
  }),
}));

import { AcpRuntime } from '../acp-runtime.js';

describe('AcpRuntime', () => {
  let runtime: AcpRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new AcpRuntime('external_cli:claude', {
      harnessId: 'acp',
      command: 'claude',
      dispatchProtocol: 'acp',
    });
  });

  it('start() creates AcpClient and calls connect()', async () => {
    await runtime.start();
    expect(mockAcpClient.connect).toHaveBeenCalled();
  });

  it('healthCheck returns false before start', () => {
    expect(runtime['client']).toBeNull();
  });

  it('healthCheck returns true after start', async () => {
    await runtime.start();
    expect(runtime['client']).not.toBeNull();
  });

  it('stop() disconnects client', async () => {
    await runtime.start();
    await runtime.stop();
    expect(mockAcpClient.disconnect).toHaveBeenCalled();
    expect(runtime['client']).toBeNull();
  });

  it('dispatchTask returns completed after prompt', async () => {
    await runtime.start();
    const result = await runtime.dispatchTask({
      task_id: 'task-1',
      session_id: 'sess-1',
      capability: 'default',
      input: 'hello',
      slot: {} as any,
      configuration: {
        max_retries: 2,
        timeout_ms: 5000,
        slot_write_url: '',
        working_directory: '/tmp',
      },
    });
    expect(mockAcpClient.newSession).toHaveBeenCalledWith('/tmp');
    expect(mockAcpClient.prompt).toHaveBeenCalledWith('sess_1', 'hello');
    expect(result.status).toBe('completed');
  });

  it('convertPrompt returns string input as-is', () => {
    expect(runtime.convertPrompt({ input: 'hello' } as any)).toBe('hello');
  });

  it('convertPrompt JSON-stringifies non-string input', () => {
    expect(runtime.convertPrompt({ input: { key: 'val' } } as any)).toBe(
      JSON.stringify({ key: 'val' }),
    );
  });
});
