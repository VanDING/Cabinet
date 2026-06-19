import { describe, it, expect } from 'vitest';
import { exportBlueprint, importBlueprint, validateWorkflowExport } from '../blueprint-io.js';
import type { WorkflowNodeDef } from '@cabinet/types';
import type { WorkflowEdge } from '../engine';
import type { WorkflowBlueprint } from '../blueprint-io';

describe('exportBlueprint', () => {
  it('exports nodes and edges in cabinet-workflow/v1 format', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'n1', type: 'start' },
      { id: 'n2', type: 'llm', prompt: 'hello' },
      { id: 'n3', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
    ];

    const bp = exportBlueprint(nodes, edges);

    expect(bp.format).toBe('cabinet-workflow/v1');
    expect(bp.definition.nodes).toHaveLength(3);
    expect(bp.definition.edges).toHaveLength(2);
    expect(bp.definition.nodes[0]!.id).toBe('n1');
    expect(bp.definition.nodes[1]!.prompt).toBe('hello');
  });

  it('contains all required fields', () => {
    const nodes: WorkflowNodeDef[] = [{ id: 'n1', type: 'start' }];
    const edges: WorkflowEdge[] = [];

    const bp = exportBlueprint(nodes, edges);

    expect(bp).toHaveProperty('format');
    expect(bp).toHaveProperty('exportedAt');
    expect(bp).toHaveProperty('sourceInstance');
    expect(bp).toHaveProperty('definition');
    expect(bp).toHaveProperty('agents');
    expect(bp).toHaveProperty('onError');

    expect(typeof bp.exportedAt).toBe('string');
    expect(bp.sourceInstance).toMatch(/^daemon_/);
    expect(bp.agents).toEqual({});
    expect(bp.onError).toBeNull();
  });

  it('resolves agents via registry', () => {
    const nodes: WorkflowNodeDef[] = [{ id: 'n1', type: 'llm', agentId: 'agent-a' }];
    const edges: WorkflowEdge[] = [];
    const agentRegistry = {
      get: (id: string) => {
        if (id === 'agent-a') return { external: { protocol: 'a2a' } };
        return null;
      },
    };

    const bp = exportBlueprint(nodes, edges, agentRegistry);

    expect(bp.agents['agent-a']).toEqual({
      harnessId: 'a2a',
      fallback: 'generic',
    });
  });
});

describe('importBlueprint', () => {
  it('imports valid blueprint back to nodes and edges', () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      { id: 'ai', type: 'llm', prompt: 'analyze', agentId: 'test-agent' },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'ai' },
      { from: 'ai', to: 'end' },
    ];

    const bp = exportBlueprint(nodes, edges);
    const result = importBlueprint(bp);

    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.nodes[0]!.id).toBe('start');
    expect(result.nodes[1]!.prompt).toBe('analyze');
    expect(result.nodes[1]!.agentId).toBe('test-agent');
    expect(result.edges[0]!.from).toBe('start');
    expect(result.edges[0]!.to).toBe('ai');
  });

  it('reports missing agents when agentRegistry is empty', () => {
    const nodes: WorkflowNodeDef[] = [{ id: 'n1', type: 'llm', agentId: 'missing-agent' }];
    const edges: WorkflowEdge[] = [];
    const bp = exportBlueprint(nodes, edges);

    const result = importBlueprint(bp, { get: () => null });

    expect(result.missingAgents).toHaveLength(1);
    expect(result.missingAgents[0]!.agentId).toBe('missing-agent');
    expect(result.resolvedAgents).toHaveLength(0);
  });
});

describe('validateWorkflowExport', () => {
  it('returns no issues for a valid blueprint', () => {
    const bp: WorkflowBlueprint = {
      format: 'cabinet-workflow/v1',
      exportedAt: '2025-01-01T00:00:00.000Z',
      sourceInstance: 'daemon_test',
      definition: {
        nodes: [
          { id: 'n1', type: 'start' },
          { id: 'n2', type: 'end' },
        ],
        edges: [{ from: 'n1', to: 'n2' }],
      },
      agents: {},
      onError: null,
    };

    const issues = validateWorkflowExport(bp);
    expect(issues).toEqual([]);
  });

  it('detects missing format field', () => {
    const bp = {
      definition: {
        nodes: [{ id: 'n1', type: 'start' }],
        edges: [],
      },
    } as unknown as WorkflowBlueprint;

    const issues = validateWorkflowExport(bp);
    expect(issues).toContain('Missing "format" field.');
  });

  it('detects duplicate node IDs', () => {
    const bp: WorkflowBlueprint = {
      format: 'cabinet-workflow/v1',
      exportedAt: '2025-01-01T00:00:00.000Z',
      sourceInstance: 'daemon_test',
      definition: {
        nodes: [
          { id: 'dup', type: 'start' },
          { id: 'dup', type: 'end' },
        ],
        edges: [],
      },
      agents: {},
      onError: null,
    };

    const issues = validateWorkflowExport(bp);
    expect(issues).toContain('Duplicate node ID: "dup".');
  });
});
