import { describe, it, expect } from 'vitest';
import { parseYamlBlueprint } from '../blueprint-yaml.js';

describe('parseYamlBlueprint', () => {
  it('parses a valid minimal blueprint', () => {
    const result = parseYamlBlueprint({
      name: 'test',
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { from: 'start', to: 'end' },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.name).toBe('test');
    expect(result.entry).toBe('start');
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('parses a blueprint with all node fields', () => {
    const result = parseYamlBlueprint({
      name: 'full',
      entry: 'a',
      nodes: [
        {
          id: 'a',
          type: 'agentGroup',
          title: 'Agent A',
          description: 'Desc',
          role: 'secretary',
          systemPrompt: 'You are a helper',
          model: 'gpt-4',
          persistent: true,
          allowedTools: ['tool1'],
          prompt: 'Do this',
          temperature: 0.7,
          maxTokens: 1000,
          outputFormat: 'json',
          skillId: 'skill1',
          toolId: 'tool1',
          code: 'console.log(1)',
          codeTimeout: 5000,
          workflowId: 'wf1',
          synchronous: false,
          loopType: 'count',
          loopCount: 3,
          loopCondition: 'true',
          loopMaxIterations: 10,
          loopOutputMode: 'merge',
          waitStrategy: 'all',
          failStrategy: 'continue',
          mergeStrategy: 'object',
          mergeTimeout: 30000,
          kbId: 'kb1',
          queryTemplate: 'q',
          topK: 5,
          scoreThreshold: 0.8,
          approvalTitle: 'Approve?',
          options: ['yes', 'no'],
          outputSchema: { answer: 'string' },
          humanDeadline: '2026-01-01',
          onError: 'continue',
          errorTriggerWorkflowId: 'err1',
          outputAs: 'result',
          data: { key: 'value' },
        },
      ],
      edges: [],
    });
    expect(result.ok).toBe(true);
    expect(result.nodes).toBeDefined();
    const node = result.nodes![0];
    expect(node!.id).toBe('a');
    expect(node!.type).toBe('agentGroup');
    expect(node!.title).toBe('Agent A');
    expect(node!.role).toBe('secretary');
    expect(node!.persistent).toBe(true);
    expect(node!.allowedTools).toEqual(['tool1']);
    expect(node!.temperature).toBe(0.7);
    expect(node!.outputFormat).toBe('json');
    expect(node!.loopType).toBe('count');
    expect(node!.loopCount).toBe(3);
    expect(node!.mergeStrategy).toBe('object');
    expect(node!.onError).toBe('continue');
    expect(node!.data).toEqual({ key: 'value' });
  });

  it('rejects invalid input (not an object)', () => {
    const result = parseYamlBlueprint(null);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Invalid YAML: expected an object');
  });

  it('rejects missing required fields', () => {
    const result = parseYamlBlueprint({
      nodes: [],
      edges: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing required field: name');
    expect(result.errors).toContain('Missing required field: entry');
  });

  it('rejects invalid nodes array', () => {
    const result = parseYamlBlueprint({
      name: 'test',
      entry: 'start',
      nodes: 'not-array',
      edges: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing or invalid field: nodes (expected array)');
  });

  it('rejects invalid edges array', () => {
    const result = parseYamlBlueprint({
      name: 'test',
      entry: 'start',
      nodes: [{ id: 'start', type: 'start' }],
      edges: 'not-array',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Missing or invalid field: edges (expected array)');
  });

  it('reports missing node id and type', () => {
    const result = parseYamlBlueprint({
      name: 'test',
      entry: 'start',
      nodes: [{}],
      edges: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('nodes[0]: missing id');
    expect(result.errors).toContain('nodes[0]: missing or invalid type');
  });

  it('reports missing edge from and to', () => {
    const result = parseYamlBlueprint({
      name: 'test',
      entry: 'start',
      nodes: [{ id: 'start', type: 'start' }],
      edges: [{}],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('edges[0]: missing from');
    expect(result.errors).toContain('edges[0]: missing to');
  });

  it('reports entry node not found', () => {
    const result = parseYamlBlueprint({
      name: 'test',
      entry: 'missing',
      nodes: [{ id: 'start', type: 'start' }],
      edges: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Entry node "missing" not found in nodes');
  });

  it('filters non-string allowedTools', () => {
    const result = parseYamlBlueprint({
      name: 'test',
      entry: 'a',
      nodes: [{
        id: 'a',
        type: 'start',
        allowedTools: ['tool1', 123, true, 'tool2'],
      }],
      edges: [],
    });
    expect(result.ok).toBe(true);
    expect(result.nodes).toBeDefined();
    expect(result.nodes![0]!.allowedTools).toEqual(['tool1', 'tool2']);
  });

  it('filters non-string options', () => {
    const result = parseYamlBlueprint({
      name: 'test',
      entry: 'a',
      nodes: [{
        id: 'a',
        type: 'approval',
        options: ['yes', 123, 'no'],
      }],
      edges: [],
    });
    expect(result.ok).toBe(true);
    expect(result.nodes).toBeDefined();
    expect(result.nodes![0]!.options).toEqual(['yes', 'no']);
  });
});
