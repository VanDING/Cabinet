import { describe, it, expect } from 'vitest';
import { HarnessRuntimeFactory, HARNESS_IDS } from '../factory.js';
import { ClaudeCodeRuntime } from '../claude-code.js';
import { GenericCliRuntime } from '../generic.js';
import { A2AHarnessRuntime } from '../a2a.js';
import type { ExternalTask } from '../../types.js';

const makeTask = (overrides: Partial<ExternalTask> = {}): ExternalTask => ({
  task_id: 'test-task',
  session_id: 'test-session',
  capability: 'default',
  input: 'write hello world',
  slot: {
    version: 0,
    project: { name: 'test', goals: [] },
    memories: [],
    files: [],
    discoveries: [],
    previous_outputs: [],
    security: { level: 'L1', maxRetries: 2 },
  },
  configuration: {
    max_retries: 2,
    timeout_ms: 120000,
    slot_write_url: '',
    working_directory: '/tmp/test',
  },
  ...overrides,
});

describe('HarnessRuntimeFactory', () => {
  it('detects claude from command name', () => {
    expect(HarnessRuntimeFactory.detectFromCommand('claude')).toBe('claude-code');
  });

  it('detects codex from command name', () => {
    expect(HarnessRuntimeFactory.detectFromCommand('codex')).toBe('codex');
  });

  it('detects opencode from command name', () => {
    expect(HarnessRuntimeFactory.detectFromCommand('opencode')).toBe('opencode');
  });

  it('detects a2a from baseUrl config via resolveHarnessId', () => {
    expect(
      HarnessRuntimeFactory.resolveHarnessId({
        harnessId: 'generic',
        baseUrl: 'http://localhost:8080',
      }),
    ).toBe('a2a');
  });

  it('falls back to generic for unknown commands', () => {
    expect(HarnessRuntimeFactory.detectFromCommand('unknown-tool')).toBe('generic');
  });

  it('exports HARNESS_IDS map with expected entries', () => {
    expect(HARNESS_IDS.CLAUDE_CODE).toBe('claude-code');
    expect(HARNESS_IDS.CODEX).toBe('codex');
    expect(HARNESS_IDS.OPENCODE).toBe('opencode');
    expect(HARNESS_IDS.A2A).toBe('a2a');
    expect(HARNESS_IDS.GENERIC).toBe('generic');
  });
});

describe('ClaudeCodeRuntime', () => {
  const runtime = new ClaudeCodeRuntime('agent-1', {
    harnessId: 'claude-code',
    command: 'claude',
  });

  it('converts task to Claude-native prompt format', () => {
    const task = makeTask();
    const result = runtime.convertPrompt(task);
    expect(result).toContain('write hello world');
    expect(result).toContain('## Task');
  });

  it('injectSkill returns markdown content', () => {
    const skill = runtime.injectSkill();
    expect(skill).toBeTruthy();
    expect(typeof skill).toBe('string');
  });
});

describe('GenericCliRuntime', () => {
  const runtime = new GenericCliRuntime('agent-1', {
    harnessId: 'generic',
    command: 'echo',
    env: { TEST: '1' },
  });

  it('converts task to Chinese instruction format', () => {
    const task = makeTask();
    const result = runtime.convertPrompt(task);
    expect(result).toContain('write hello world');
    expect(result).toContain('## \u4efb\u52a1');
    expect(result).toContain('## \u5b89\u5168\u7ea6\u675f');
  });

  it('parseOutput returns completed with plain output', () => {
    const result = runtime.parseOutput('hello world', '', 'task-1', new Date().toISOString());
    expect(result.status).toBe('completed');
    expect(result.output).toBe('hello world');
    expect(result.task_id).toBe('task-1');
  });

  it('parseOutput handles empty stdout', () => {
    const result = runtime.parseOutput('', '', 'task-1', new Date().toISOString());
    expect(result.status).toBe('completed');
  });

  it('injectSkill returns non-empty string', () => {
    const skill = runtime.injectSkill();
    expect(skill).toBeTruthy();
  });
});

describe('A2AHarnessRuntime', () => {
  const runtime = new A2AHarnessRuntime('agent-1', {
    harnessId: 'a2a',
    baseUrl: 'http://localhost:8080',
    healthCheckUrl: 'http://localhost:8080/health',
  });

  it('converts task to A2A JSON format', () => {
    const task = makeTask();
    const result = runtime.convertPrompt(task);
    expect(result).toContain('write hello world');
    expect(result).toContain('test-task');
  });

  it('parseOutput parses JSON status correctly', () => {
    const output = JSON.stringify({
      status: 'completed',
      output: 'done',
      timestamp: new Date().toISOString(),
    });
    const result = runtime.parseOutput(output, '', 'task-1', new Date().toISOString());
    expect(result.status).toBe('completed');
    expect(result.output).toBe('done');
  });

  it('parseOutput handles non-JSON stdout as completed', () => {
    const result = runtime.parseOutput('some raw text', '', 'task-1', new Date().toISOString());
    expect(result.status).toBe('completed');
    expect(result.output).toBe('some raw text');
  });

  it('injectSkill returns non-empty string', () => {
    const skill = runtime.injectSkill();
    expect(skill).toBeTruthy();
  });
});
