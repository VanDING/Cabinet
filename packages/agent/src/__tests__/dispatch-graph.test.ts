import { describe, it, expect } from 'vitest';
import {
  executeDispatchGraph,
  compileDispatchGraph,
  type AgentStepFn,
  type SynthesizeFn,
} from '../dispatch-graph.js';
import type { PipelineStep, AgentOutput } from '@cabinet/types';
import type { AgentRoleType } from '../agent-roles.js';

function makeStep(
  role: string,
  overrides: Partial<PipelineStep & { structuredOutput?: AgentOutput }> = {},
): PipelineStep & { structuredOutput?: AgentOutput } {
  return {
    role: role as AgentRoleType,
    status: 'completed',
    input: '',
    output: `Output from ${role}`,
    durationMs: 100,
    steps: 1,
    structuredOutput: {
      summary: `${role} summary`,
      confidence: 0.9,
      findings: [{ type: 'observation', detail: `${role} finding`, severity: 'medium' }],
    },
    ...overrides,
  };
}

describe('compileDispatchGraph', () => {
  const noopStep: AgentStepFn = async (role) => makeStep(role);

  it('compiles single mode with one node', () => {
    const nodes = compileDispatchGraph({
      mode: 'single',
      roles: ['secretary'],
      request: 'test',
      agentStep: noopStep,
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.id).toBe('single');
  });

  it('compiles pipeline mode with chained nodes', () => {
    const nodes = compileDispatchGraph({
      mode: 'pipeline',
      roles: ['secretary', 'reviewer'],
      request: 'test',
      agentStep: noopStep,
    });
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.next).toBe('pipeline_1');
    expect(nodes[1]!.next).toBeUndefined();
  });

  it('compiles parallel mode with fork nodes + synthesize join', () => {
    const nodes = compileDispatchGraph({
      mode: 'parallel',
      roles: ['secretary', 'reviewer', 'analyst'],
      request: 'test',
      agentStep: noopStep,
    });
    // 3 agent nodes + 1 synthesize node
    expect(nodes).toHaveLength(4);
    expect(nodes[3]!.isJoin).toBe(true);
  });
});

describe('executeDispatchGraph', () => {
  const step: AgentStepFn = async (role, input) =>
    makeStep(role, { input, output: `[${role}] processed: ${input.slice(0, 30)}` });

  const synthesize: SynthesizeFn = (outputs) => ({
    output: {
      summary: outputs.map((o) => o.summary).join(' | '),
      confidence: outputs.reduce((s, o) => s + (o.confidence ?? 0.5), 0) / outputs.length,
      findings: outputs.flatMap((o) => o.findings ?? []),
    },
  });

  it('executes single mode — returns one step', async () => {
    const result = await executeDispatchGraph({
      mode: 'single',
      roles: ['secretary'],
      request: 'analyze this',
      agentStep: step,
    });

    expect(result.mode).toBe('single');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.status).toBe('completed');
    expect(result.finalOutput).toContain('secretary');
  });

  it('executes pipeline mode — chains outputs through roles', async () => {
    const pipelineStep: AgentStepFn = async (role, input) => {
      const isFirst = input.includes('original task');
      return makeStep(role, {
        input,
        output: `[${role}] ${isFirst ? 'received original' : 'received from previous'}`,
        structuredOutput: {
          summary: `${role} handled: ${input.slice(0, 40)}`,
          confidence: 0.85,
        },
      });
    };

    const result = await executeDispatchGraph({
      mode: 'pipeline',
      roles: ['secretary', 'reviewer'],
      request: 'original task',
      agentStep: pipelineStep,
    });

    expect(result.mode).toBe('pipeline');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.status).toBe('completed');
    expect(result.steps[1]!.status).toBe('completed');
  });

  it('executes pipeline mode — stops on first failure', async () => {
    const failingStep: AgentStepFn = async (role) => {
      if (role === 'reviewer') {
        return {
          role: 'reviewer' as AgentRoleType,
          status: 'failed',
          input: '',
          error: 'review failed',
          durationMs: 10,
          steps: 0,
        };
      }
      return makeStep(role);
    };

    const result = await executeDispatchGraph({
      mode: 'pipeline',
      roles: ['secretary', 'reviewer', 'analyst'],
      request: 'test',
      agentStep: failingStep,
    });

    expect(result.steps).toHaveLength(2); // stopped at reviewer
    expect(result.finalOutput).toContain('failed');
  });

  it('executes parallel mode — runs all roles and synthesizes', async () => {
    const result = await executeDispatchGraph({
      mode: 'parallel',
      roles: ['secretary', 'reviewer', 'analyst'],
      request: 'review the codebase',
      agentStep: step,
      synthesize,
      maxConcurrency: 3,
    });

    expect(result.mode).toBe('parallel');
    expect(result.steps).toHaveLength(3);
    expect(result.finalOutput).toContain('Synthesized');
  });

  it('executes parallel mode with concurrency limiting', async () => {
    const executionOrder: string[] = [];
    const trackedStep: AgentStepFn = async (role) => {
      executionOrder.push(role);
      return makeStep(role);
    };

    await executeDispatchGraph({
      mode: 'parallel',
      roles: ['r1', 'r2', 'r3', 'r4'],
      request: 'test',
      agentStep: trackedStep,
      maxConcurrency: 2,
    });

    expect(executionOrder).toHaveLength(4);
  });
});
