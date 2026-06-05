import { describe, it, expect } from 'vitest';
import {
  createAgentCard,
  agentCardResponse,
  parseTask,
  taskResultResponse,
} from '../a2a-helper.js';

describe('createAgentCard', () => {
  it('builds a valid A2A agent card', () => {
    const card = createAgentCard({
      agent_id: 'my-agent',
      display_name: 'My Agent',
      base_url: 'https://example.com',
      capabilities: [
        { name: 'code_review', description: 'Reviews code' },
      ],
    });

    expect(card.agent_id).toBe('my-agent');
    expect(card.display_name).toBe('My Agent');
    expect(card.version).toBe('1.0.0'); // default
    expect(card.connection.protocol).toBe('a2a');
    expect(card.connection.base_url).toBe('https://example.com');
    expect(card.connection.health_check).toBe('https://example.com/health');
    expect(card.capabilities).toHaveLength(1);
    expect(card.capabilities[0]!.name).toBe('code_review');
  });

  it('uses provided version if specified', () => {
    const card = createAgentCard({
      agent_id: 'a',
      display_name: 'A',
      version: '2.0.0',
      base_url: 'https://x.com',
      capabilities: [],
    });
    expect(card.version).toBe('2.0.0');
  });

  it('includes description when provided', () => {
    const card = createAgentCard({
      agent_id: 'a',
      display_name: 'A',
      description: 'A helper agent',
      base_url: 'https://x.com',
      capabilities: [],
    });
    expect(card.description).toBe('A helper agent');
  });

  it('omits description when not provided', () => {
    const card = createAgentCard({
      agent_id: 'a',
      display_name: 'A',
      base_url: 'https://x.com',
      capabilities: [],
    });
    expect(card.description).toBeUndefined();
  });

  it('supports capabilities with schemas and security level', () => {
    const card = createAgentCard({
      agent_id: 'a',
      display_name: 'A',
      base_url: 'https://x.com',
      capabilities: [{
        name: 'secure_op',
        description: 'A secure operation',
        input_schema: { type: 'object' },
        output_schema: { type: 'object' },
        security_level: 'high',
      }],
    });
    expect(card.capabilities[0]!.input_schema).toEqual({ type: 'object' });
    expect(card.capabilities[0]!.security_level).toBe('high');
  });
});

describe('agentCardResponse', () => {
  it('returns a 200 JSON Response', async () => {
    const card = createAgentCard({
      agent_id: 'a',
      display_name: 'A',
      base_url: 'https://x.com',
      capabilities: [],
    });
    const resp = agentCardResponse(card);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('application/json');
    const body = await resp.json();
    expect(body.agent_id).toBe('a');
  });
});

describe('parseTask', () => {
  it('parses a valid A2A task body', () => {
    const task = parseTask({
      task_id: 'task-1',
      session_id: 'session-1',
      capability: 'code_review',
      input: { file: 'test.ts' },
      slot: { project: 'my-project' },
      configuration: { max_retries: 3, timeout_ms: 60_000, slot_write_url: '/api/slot' },
    });

    expect(task.task_id).toBe('task-1');
    expect(task.session_id).toBe('session-1');
    expect(task.capability).toBe('code_review');
    expect(task.input).toEqual({ file: 'test.ts' });
    expect(task.slot).toEqual({ project: 'my-project' });
    expect(task.configuration.max_retries).toBe(3);
    expect(task.configuration.timeout_ms).toBe(60_000);
  });

  it('throws when task_id is missing', () => {
    expect(() => parseTask({ capability: 'test' })).toThrow(
      'Invalid A2A task: missing task_id or capability',
    );
  });

  it('throws when capability is missing', () => {
    expect(() => parseTask({ task_id: 't1' })).toThrow(
      'Invalid A2A task: missing task_id or capability',
    );
  });

  it('uses defaults for missing session_id and configuration', () => {
    const task = parseTask({
      task_id: 't1',
      capability: 'test',
    });
    expect(task.session_id).toBe('');
    expect(task.configuration.max_retries).toBe(2);
    expect(task.configuration.timeout_ms).toBe(120_000);
  });

  it('uses empty object as default slot', () => {
    const task = parseTask({
      task_id: 't1',
      capability: 'test',
    });
    expect(task.slot).toEqual({});
  });
});

describe('taskResultResponse', () => {
  it('returns a 200 JSON Response for completed task', async () => {
    const resp = taskResultResponse({
      status: 'completed',
      output: { result: 'ok' },
      tokens_used: 150,
      model: 'sonnet',
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('application/json');
    const body = await resp.json();
    expect(body.status).toBe('completed');
    expect(body.output).toEqual({ result: 'ok' });
    expect(body.tokens_used).toBe(150);
  });

  it('returns correct response for failed task', async () => {
    const resp = taskResultResponse({
      status: 'failed',
      output: { error: 'timeout' },
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe('failed');
  });
});
