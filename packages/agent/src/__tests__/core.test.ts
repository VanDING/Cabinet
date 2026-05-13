import { describe, it, expect, beforeEach } from 'vitest';
import { ToolExecutor } from '../tool-executor.js';
import { SafetyChecker } from '../safety.js';
import { classifyError, withRetry } from '../retry.js';

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
      execute: async () => { throw new Error('boom'); },
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

  it('allows known safe tools at cache tier', () => {
    const result = safety.check('read_file', {});
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('cache');
  });

  it('blocks dangerous tools at ai_classifier tier', () => {
    const result = safety.check('delete_file', {});
    expect(result.allowed).toBe(false);
    expect(result.tier).toBe('ai_classifier');
    expect(result.reason).toContain('teach-back');
  });

  it('allows unknown tools at auto tier', () => {
    const result = safety.check('custom_tool', {});
    expect(result.allowed).toBe(true);
    expect(result.tier).toBe('auto');
  });

  it('supports custom whitelist', () => {
    const custom = new SafetyChecker(['my_safe_tool']);
    expect(custom.check('my_safe_tool', {}).allowed).toBe(true);
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
