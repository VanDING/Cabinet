import { describe, it, expect } from 'vitest';
import {
  createAgentCard,
  parseTask,
  agentCardResponse,
  taskResultResponse,
} from '../a2a-helper.js';

describe('A2A helper', () => {
  it('creates agent card with correct structure', () => {
    const card = createAgentCard({
      agent_id: 'test-agent',
      display_name: 'Test Agent',
      base_url: 'http://localhost:8080',
      capabilities: [{ name: 'code', description: 'Writes code' }],
    });
    expect(card.agent_id).toBe('test-agent');
    expect(card.display_name).toBe('Test Agent');
    expect(card.connection.base_url).toBe('http://localhost:8080');
    expect(card.capabilities).toHaveLength(1);
    expect(card.capabilities[0]!.name).toBe('code');
  });

  it('defaults version to 1.0.0', () => {
    const card = createAgentCard({
      agent_id: 'test',
      display_name: 'Test',
      base_url: 'http://localhost',
      capabilities: [],
    });
    expect(card.version).toBe('1.0.0');
  });

  it('parses valid A2A task', () => {
    const task = parseTask({
      task_id: 't1',
      capability: 'code',
      input: 'write hello world',
    });
    expect(task.task_id).toBe('t1');
    expect(task.capability).toBe('code');
    expect(task.input).toBe('write hello world');
  });

  it('throws on missing task_id', () => {
    expect(() => parseTask({ capability: 'code' })).toThrow('Invalid A2A task');
  });

  it('throws on missing capability', () => {
    expect(() => parseTask({ task_id: 't1' })).toThrow('Invalid A2A task');
  });

  it('builds agent card Response', () => {
    const card = createAgentCard({
      agent_id: 'test',
      display_name: 'Test',
      base_url: 'http://localhost',
      capabilities: [],
    });
    const res = agentCardResponse(card);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('builds task result Response', () => {
    const res = taskResultResponse({ status: 'completed', output: 'done' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});
