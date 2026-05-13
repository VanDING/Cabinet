import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine, type WorkflowNode, type WorkflowEdge } from '../engine';

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.registerSkillHandler('skill-a', async (input) => `Result: ${JSON.stringify(input)}`);
    engine.registerSkillHandler('skill-b', async (input) => `Done: ${JSON.stringify(input)}`);
  });

  it('executes linear workflow A→B', async () => {
    const nodes: WorkflowNode[] = [
      { id: 'n1', type: 'skill', skillId: 'skill-a' },
      { id: 'n2', type: 'skill', skillId: 'skill-b' },
    ];
    const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2' }];
    const run = await engine.startRun('wf-1', nodes, edges, 'n1');
    expect(run.status).toBe('completed');
    expect(run.results.get('n1')).toContain('Result');
    expect(run.results.get('n2')).toContain('Done');
  });

  it('fails on unknown skill', async () => {
    const nodes: WorkflowNode[] = [{ id: 'n1', type: 'skill', skillId: 'nonexistent' }];
    const edges: WorkflowEdge[] = [];
    const run = await engine.startRun('wf-2', nodes, edges, 'n1');
    expect(run.status).toBe('failed');
  });

  it('human node returns awaiting_approval', async () => {
    const nodes: WorkflowNode[] = [{ id: 'n1', type: 'human', title: 'Approve' }];
    const edges: WorkflowEdge[] = [];
    const run = await engine.startRun('wf-3', nodes, edges, 'n1');
    expect(run.status).toBe('completed');
    const result = run.results.get('n1') as any;
    expect(result.status).toBe('awaiting_approval');
  });
});
