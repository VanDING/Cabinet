import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: vi.fn(), existsSync: vi.fn() }));
vi.mock('node:os', () => ({ homedir: () => '/mock/home' }));

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

function createMockProcess(exitCode: number | null = 0, stdoutText = '1.0.0') {
  const proc = new EventEmitter() as any;
  proc.stdout = {
    on: vi.fn((_ev: string, cb: (c: Buffer) => void) => {
      if (stdoutText) process.nextTick(() => cb(Buffer.from(stdoutText)));
    }),
    pipe: vi.fn(),
  };
  proc.stderr = { on: vi.fn(), pipe: vi.fn() };
  proc.stdin = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  process.nextTick(() => proc.emit('close', exitCode));
  return proc;
}

describe('Scanner', () => {
  let registry: { registerExternalAgent: ReturnType<typeof vi.fn> };
  let agentRoleRepo: { upsert: ReturnType<typeof vi.fn>; findByName: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    registry = { registerExternalAgent: vi.fn().mockReturnValue(true) };
    agentRoleRepo = { upsert: vi.fn(), findByName: vi.fn().mockReturnValue(null) };
  });

  it('scanOne returns installed=true for a detected agent', async () => {
    (spawn as any).mockImplementation(() => createMockProcess(0));
    const { Scanner } = await import('../scanner.js');
    const { RECIPES } = await import('../scanner-recipe.js');

    const scanner = new Scanner(registry as any, agentRoleRepo as any);
    const result = await scanner.scanOne(RECIPES[0]);
    expect(result.installed).toBe(true);
    expect(result.version).toBe('1.0.0');
    expect(registry.registerExternalAgent).toHaveBeenCalled();
    expect(agentRoleRepo.upsert).toHaveBeenCalled();
    const upsertArg = agentRoleRepo.upsert.mock.calls[0][0];
    expect(upsertArg.external_config).toBeDefined();
    const config = JSON.parse(upsertArg.external_config);
    expect(config.command).toBe('claude');
  });

  it('scanOne returns installed=false for undetected agent', async () => {
    (spawn as any).mockImplementation(() => createMockProcess(1));
    const { Scanner } = await import('../scanner.js');
    const { RECIPES } = await import('../scanner-recipe.js');

    const scanner = new Scanner(registry as any, agentRoleRepo as any);
    const result = await scanner.scanOne(RECIPES[0]);
    expect(result.installed).toBe(false);
    expect(registry.registerExternalAgent).not.toHaveBeenCalled();
  });

  it('scanAll scans all recipes', async () => {
    (spawn as any).mockImplementation(() => createMockProcess(1));
    const { Scanner } = await import('../scanner.js');

    const scanner = new Scanner(registry as any, agentRoleRepo as any);
    const results = await scanner.scanAll();
    expect(results).toHaveLength(9);
  });
});
