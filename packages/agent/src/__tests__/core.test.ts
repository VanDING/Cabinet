import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '../tool-executor.js';
import { SafetyChecker } from '../safety.js';
import { classifyError, withRetry } from '../retry.js';
import { AgentRoleRegistry } from '../agent-roles.js';

describe('ToolExecutor', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  it('executes registered tool', async () => {
    executor.register({
      name: 'echo',
      execute: async (args) => args.message,
    });
    const result = await executor.execute('echo', 'call-1', { message: 'hello' });
    expect(result.output).toBe('hello');
    expect(result.error).toBeUndefined();
  });

  it('returns error for unknown tool', async () => {
    const result = await executor.execute('nonexistent', 'call-1', {});
    expect(result.error).toContain('Unknown tool');
  });

  it('returns error on tool execution failure', async () => {
    executor.register({
      name: 'failing',
      execute: async () => {
        throw new Error('boom');
      },
    });
    const result = await executor.execute('failing', 'call-1', {});
    expect(result.error).toBe('boom');
  });

  it('lists registered tools', () => {
    executor.register({ name: 'a', execute: async () => null });
    executor.register({ name: 'b', execute: async () => null });
    expect(executor.listTools()).toEqual(['a', 'b']);
  });
});

describe('SafetyChecker', () => {
  let safety: SafetyChecker;

  beforeEach(() => {
    safety = new SafetyChecker();
  });

  it('allows read-only tools at cache tier', () => {
    const result = safety.check('query_decisions', {});
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('cache');
  });

  it('blocks dangerous tools at delegation_block tier (T1 default)', () => {
    const result = safety.check('delete_workflow', {});
    expect(result.allowed).toBe(false);
    expect(result.tier).toBe('delegation_block');
    expect(result.blockedByTier).toBe('T1');
  });

  it('allows uncategorized tools at auto tier', () => {
    const result = safety.check('custom_tool', {});
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('auto');
  });

  it('allows destructive tools at T3 (Full Autonomy)', () => {
    const t3 = new SafetyChecker('T3');
    expect(t3.check('approve_decision', {}).allowed).toBe(true);
  });

  it('blocks cost tools at T1 but allows at T2', () => {
    const t1 = new SafetyChecker('T1');
    expect(t1.check('run_workflow', {}).allowed).toBe(false);

    const t2 = new SafetyChecker('T2');
    expect(t2.check('run_workflow', {}).allowed).toBe(true);
  });

  it('blocks all writes at T0', () => {
    const t0 = new SafetyChecker('T0');
    expect(t0.check('write_memory', {}).allowed).toBe(false);
    expect(t0.check('create_decision', {}).allowed).toBe(false);
    // Read-only is always allowed
    expect(t0.check('get_status', {}).allowed).toBe(true);
  });
});

describe('classifyError', () => {
  it('classifies timeout as transient', () => {
    expect(classifyError(new Error('Request timeout'))).toBe('transient');
  });

  it('classifies 429 as transient', () => {
    expect(classifyError(new Error('HTTP 429 rate limit exceeded'))).toBe('transient');
  });

  it('classifies unknown as fatal', () => {
    expect(classifyError(new Error('Something went wrong'))).toBe('fatal');
  });
});

describe('withRetry', () => {
  it('retries transient errors', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('timeout');
      return 'success';
    };
    const result = await withRetry(fn, new Error('timeout'), { baseDelayMs: 1 });
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('does not retry fatal errors', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('fatal error');
    };
    await expect(withRetry(fn, new Error('fatal error'))).rejects.toThrow('fatal error');
    expect(attempts).toBe(1);
  });
});

describe('AgentRoleRegistry', () => {
  it('should not contain workflow_designer or agent_creator', () => {
    const registry = new AgentRoleRegistry();
    const builtIn = registry.listBuiltIn();
    const types = builtIn.map((r) => r.type);
    expect(types).not.toContain('workflow_designer');
    expect(types).not.toContain('agent_creator');
    expect(types).toContain('secretary');
    expect(types).toContain('organize');
  });
});
