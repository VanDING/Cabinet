import { describe, it, expect } from 'vitest';
import { parseBlueprint, BlueprintParseError } from '../blueprint-parser.js';

describe('parseBlueprint', () => {
  it('parses code-fenced JSON blueprint', () => {
    const text = [
      'Here is the plan:',
      '```json',
      '{',
      '  "meta": { "goal": "Test" },',
      '  "agents": [{ "action": "create_new", "name": "TestAgent" }],',
      '  "workflow": { "steps": [{ "id": "s1", "type": "agentGroup" }] }',
      '}',
      '```',
    ].join('\n');

    const bp = parseBlueprint(text);
    expect(bp.meta?.goal).toBe('Test');
    expect(bp.agents).toHaveLength(1);
    expect(bp.agents![0]!.name).toBe('TestAgent');
    expect(bp.workflow?.steps).toHaveLength(1);
  });

  it('parses inline JSON without fences', () => {
    const text = 'The blueprint is: {"meta": {"goal": "Inline"}, "workflow": {"steps": []}}';
    const bp = parseBlueprint(text);
    expect(bp.meta?.goal).toBe('Inline');
  });

  it('parses blueprint surrounded by natural language', () => {
    const text = [
      'Here is the proposed organization:',
      '',
      '## Goal',
      'We need to build a review system.',
      '',
      '```json',
      '{"meta": {"goal": "Build review system"}, "agents": [], "workflow": {"steps": []}}',
      '```',
      '',
      'Let me know if this looks good.',
    ].join('\n');

    const bp = parseBlueprint(text);
    expect(bp.meta?.goal).toBe('Build review system');
  });

  it('throws on non-JSON text', () => {
    expect(() => parseBlueprint('Hello, here is my plan for the organization.')).toThrow(
      BlueprintParseError,
    );
  });

  it('throws on JSON that is not a blueprint', () => {
    expect(() => parseBlueprint('{"foo": "bar"}')).toThrow(BlueprintParseError);
  });

  it('normalizes partial blueprint with defaults', () => {
    const bp = parseBlueprint('{"meta": {"goal": "Partial"}}');
    expect(bp.meta?.goal).toBe('Partial');
    expect(bp.agents).toEqual([]);
    expect(bp.workflow?.steps).toEqual([]);
    expect(bp.harness?.gates).toEqual([]);
    expect(bp.authorization?.rules).toEqual([]);
  });

  it('handles multiple code blocks, picks first valid blueprint', () => {
    const text = [
      '```json',
      '{"meta": {"goal": "First"}, "agents": []}',
      '```',
      '```json',
      '{"meta": {"goal": "Second"}, "agents": []}',
      '```',
    ].join('\n');

    const bp = parseBlueprint(text);
    expect(bp.meta?.goal).toBe('First');
  });
});
