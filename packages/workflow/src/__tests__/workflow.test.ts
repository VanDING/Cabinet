import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine, type WorkflowNodeDef, type WorkflowEdge } from '../engine';

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.setHandlers({
      skill: async (_skillId, input) => `Result: ${JSON.stringify(input)}`,
    });
  });

  it('executes linear workflow A→B', async () => {
    const nodes: WorkflowNodeDef[] = [
      { id: 'n1', type: 'skill', skillId: 'skill-a' },
      { id: 'n2', type: 'skill', skillId: 'skill-b' },
    ];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2' }];
    const run = await engine.startRun('wf-1', nodes, edges, 'n1');
    expect(run.status).toBe('completed');
    expect(run.results.get('n1')).toContain('Result');
    expect(run.results.get('n2')).toContain('Result');
  });

  it('fails on unknown skill (no handler)', async () => {
    const emptyEngine = new WorkflowEngine();
    const nodes: WorkflowNodeDef[] = [{ id: 'n1', type: 'skill', skillId: 'nonexistent' }];
    const edges: WorkflowEdge[] = [];
    const run = await emptyEngine.startRun('wf-2', nodes, edges, 'n1');
    expect(run.status).toBe('failed');
  });

  it('human node pauses with awaiting_approval when handler returns pending', async () => {
    engine.setHandlers({
      humanApproval: async () => ({ decisionId: 'dec-1', status: 'pending' as const }),
    });
    const nodes: WorkflowNodeDef[] = [{ id: 'n1', type: 'human', title: 'Approve' }];
    const edges: WorkflowEdge[] = [];
    const run = await engine.startRun('wf-3', nodes, edges, 'n1');
    expect(run.status).toBe('awaiting_approval');
  });

  it('start→aiAgent→end flow', async () => {
    engine.setHandlers({
      aiAgent: async (_node, _input) => 'AI processed successfully',
    });
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      { id: 'ai', type: 'aiAgent', data: { prompt: 'Analyze this' } },
      { id: 'end', type: 'end' },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'ai' },
      { from: 'ai', to: 'end' },
    ];
    const run = await engine.startRun('wf-4', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    expect(run.steps.length).toBe(3);
  });

  it('condition branches to true path', async () => {
    engine.setHandlers({
      aiAgent: async () => 'approved',
    });
    const nodes: WorkflowNodeDef[] = [
      { id: 'start', type: 'start' },
      { id: 'ai1', type: 'aiAgent', data: { prompt: 'Process' } },
      { id: 'cond', type: 'condition', condition: 'approved' },
      { id: 'ai2', type: 'aiAgent', data: { prompt: 'True branch' } },
      { id: 'ai3', type: 'aiAgent', data: { prompt: 'False branch' } },
    ];
    const edges: WorkflowEdge[] = [
      { from: 'start', to: 'ai1' },
      { from: 'ai1', to: 'cond' },
      { from: 'cond', to: 'ai2' },
      { from: 'cond', to: 'ai3' },
    ];
    const run = await engine.startRun('wf-5', nodes, edges, 'start');
    expect(run.status).toBe('completed');
    // ai2 should have been executed (true branch), ai3 skipped
    const steps = run.steps.map((s) => s.nodeId);
    expect(steps).toContain('ai2');
    expect(steps).not.toContain('ai3');
  });
});
