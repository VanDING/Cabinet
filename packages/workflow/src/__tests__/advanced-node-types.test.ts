import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine, type WorkflowNodeDef, type WorkflowEdge } from '../engine';

describe('Manager node', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      aiAgent: async (_node, _input) => 'ok',
      skill: async (_skillId, input) => `Result: ${JSON.stringify(input)}`,
    });
  });

  it('executes manager node with children', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      {
        id: 'manager1',
        type: 'manager',
        children: [{ id: 'child-a', type: 'skill', skillId: 'skill-a' }],
      },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'manager1' },
      { from: 'manager1', to: 'end' },
    ];
    const run = await engine.startRun('wf-manager-1', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    expect(run.results.get('manager1')).toBeDefined();
    expect(run.steps.length).toBeGreaterThanOrEqual(3);
  });

  it('handles manager with no children', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      { id: 'manager1', type: 'manager', children: [] },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'manager1' },
      { from: 'manager1', to: 'end' },
    ];
    const run = await engine.startRun('wf-manager-2', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    expect(run.results.get('manager1')).toContain('no children to coordinate');
  });
});

describe('Parallel node', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      skill: async (_skillId, input) => `Result: ${JSON.stringify(input)}`,
    });
  });

  it('executes all parallel branches with concat merge', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      {
        id: 'parallel1',
        type: 'parallel',
        mergeStrategy: 'concat',
        children: [
          { id: 'child-a', type: 'skill', skillId: 'skill-a' },
          { id: 'child-b', type: 'skill', skillId: 'skill-b' },
        ],
      },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'parallel1' },
      { from: 'parallel1', to: 'end' },
    ];
    const run = await engine.startRun('wf-parallel-1', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    const output = run.results.get('parallel1') as string;
    expect(output).toContain('Result');
    expect(run.steps.map((s) => s.nodeId)).toContain('parallel1');
  });

  it('merges parallel results as object by default', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      {
        id: 'parallel2',
        type: 'parallel',
        children: [{ id: 'child-a', type: 'skill', skillId: 'skill-a' }],
      },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'parallel2' },
      { from: 'parallel2', to: 'end' },
    ];
    const run = await engine.startRun('wf-parallel-2', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    const output = run.results.get('parallel2') as string;
    expect(output).toContain('child-a');
  });
});

describe('Loop node', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      skill: async (_skillId, input) => `Iteration: ${JSON.stringify(input)}`,
    });
  });

  it('executes loop with count strategy', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      {
        id: 'loop1',
        type: 'loop',
        loopType: 'count',
        loopCount: 3,
        children: [{ id: 'child-loop', type: 'skill', skillId: 'skill-loop' }],
      },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'loop1' },
      { from: 'loop1', to: 'end' },
    ];
    const run = await engine.startRun('wf-loop-1', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    const output = run.results.get('loop1') as string;
    expect(output).toContain('"iteration":0');
    expect(output).toContain('"iteration":1');
    expect(output).toContain('"iteration":2');
    const childSteps = run.steps.filter((s) => s.nodeId === 'child-loop');
    expect(childSteps.length).toBe(3);
  });

  it('exits condition loop immediately when condition is false', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      {
        id: 'loop2',
        type: 'loop',
        loopType: 'condition',
        loopCondition: 'false',
        children: [{ id: 'child-loop', type: 'skill', skillId: 'skill-loop' }],
      },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'loop2' },
      { from: 'loop2', to: 'end' },
    ];
    const run = await engine.startRun('wf-loop-2', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    const childSteps = run.steps.filter((s) => s.nodeId === 'child-loop');
    expect(childSteps.length).toBe(0);
  });
});

describe('ExternalAgent node', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      dispatchToExternalAgent: async (_agentId, _task) => ({
        status: 'completed' as const,
        output: 'External agent done',
      }),
    });
  });

  it('dispatches to external agent and captures output', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      { id: 'ext1', type: 'externalAgent', agentId: 'agent-1' },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'ext1' },
      { from: 'ext1', to: 'end' },
    ];
    const run = await engine.startRun('wf-ext-1', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    expect(run.results.get('ext1')).toContain('External agent done');
    expect(run.steps.map((s) => s.nodeId)).toContain('ext1');
  });

  it('fails when external agent returns failed status', async () => {
    engine.setHandlers({
      dispatchToExternalAgent: async (_agentId, _task) => ({
        status: 'failed' as const,
      }),
    });
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      { id: 'ext2', type: 'externalAgent', agentId: 'agent-2' },
    ];
    const edges: WorkflowEdge[] = [{ from: 'start', to: 'ext2' }];
    const run = await engine.startRun('wf-ext-2', nodes, edges, 'start');
    expect(run.status).toBe('failed');
  });

  it('pauses when external agent returns awaiting_approval', async () => {
    engine.setHandlers({
      dispatchToExternalAgent: async (_agentId, _task) => ({
        status: 'awaiting_approval' as const,
        decisionId: 'dec-ext-1',
      }),
    });
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      { id: 'ext3', type: 'externalAgent', agentId: 'agent-3' },
    ];
    const edges: WorkflowEdge[] = [{ from: 'start', to: 'ext3' }];
    const run = await engine.startRun('wf-ext-3', nodes, edges, 'start');
    expect(run.status).toBe('awaiting_approval');
  });
});
