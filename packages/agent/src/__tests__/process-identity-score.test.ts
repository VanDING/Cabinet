import { describe, it, expect } from 'vitest';
import { calculatePIS } from '../process-identity-score.js';
import type { AgentExecutionContext } from '../observer-pipeline.js';

function makeCtx(partial: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    sessionId: 's1',
    projectId: 'p1',
    captainId: 'c1',
    model: 'claude-sonnet-4-6',
    messages: [],
    systemPrompt: 'Build a web app. Create API. Write tests. Deploy.',
    stepCount: 10,
    consecutiveErrors: 0,
    zoneCounts: { smart: 5, warning: 3, critical: 2, dumb: 0 },
    handoffCount: 0,
    errorCounts: { transient: 0, recoverable: 0, fatal: 0 },
    toolCounts: { total: 0, succeeded: 0, failed: 0, blocked: 0 },
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    zone: 'smart',
    toolCallHistory: [],
    currentStepText: '',
    currentStepToolCalls: [],
    handoff: null,
    finalContent: '',
    startTime: Date.now(),
    ...partial,
  } as AgentExecutionContext;
}

describe('calculatePIS', () => {
  it('returns stable trend for single evaluation', () => {
    const ctx = makeCtx();
    const pis = calculatePIS(ctx, 'Build a web app');
    expect(pis.total).toBeGreaterThanOrEqual(0);
    expect(pis.total).toBeLessThanOrEqual(1);
    expect(pis.trend).toBe('stable');
    expect(pis.factors.length).toBe(4);
  });

  it('detects low tool coherence with many different tools', () => {
    const ctx = makeCtx({
      toolCallHistory: [
        { name: 'read_file', args: {}, result: '' },
        { name: 'web_fetch', args: {}, result: '' },
        { name: 'exec_command', args: {}, result: '' },
        { name: 'search_memory', args: {}, result: '' },
        { name: 'write_file', args: {}, result: '' },
        { name: 'edit_file', args: {}, result: '' },
        { name: 'grep', args: {}, result: '' },
        { name: 'list_directory', args: {}, result: '' },
        { name: 'browser_navigate', args: {}, result: '' },
        { name: 'apply_patch', args: {}, result: '' },
      ],
    });
    const pis = calculatePIS(ctx, 'Build a web app');
    const tc = pis.factors.find((f) => f.name === 'toolCoherence');
    expect(tc!.score).toBe(0);
  });

  it('detects high tool coherence with same tool', () => {
    const ctx = makeCtx({
      toolCallHistory: Array(10).fill({ name: 'read_file', args: {}, result: '' }),
    });
    const pis = calculatePIS(ctx, 'Build a web app');
    const tc = pis.factors.find((f) => f.name === 'toolCoherence');
    expect(tc!.score).toBe(0.9); // 1 unique / 10 total = 0.9
  });

  it('goal progress detects milestone markers', () => {
    const ctx = makeCtx({
      toolCallHistory: [
        { name: 'read_file', args: {}, result: 'milestone_complete: API created' },
        { name: 'write_file', args: {}, result: 'subtask_done: auth module' },
        { name: 'edit_file', args: {}, result: 'goal_achieved: deployed' },
      ],
    });
    const pis = calculatePIS(ctx, 'Build a web app');
    const gp = pis.factors.find((f) => f.name === 'goalProgress');
    expect(gp!.score).toBeGreaterThan(0.5);
  });

  it('goal progress is neutral without markers', () => {
    const ctx = makeCtx({
      toolCallHistory: [
        { name: 'read_file', args: {}, result: 'some content' },
        { name: 'write_file', args: {}, result: 'done' },
      ],
    });
    const pis = calculatePIS(ctx, 'Build a web app');
    const gp = pis.factors.find((f) => f.name === 'goalProgress');
    expect(gp!.score).toBe(0.5);
  });

  it('recommends continue for high score', () => {
    const ctx = makeCtx({
      // Use the same tool many times for high coherence
      toolCallHistory: Array(10).fill({ name: 'build_tool', args: { app: 'web' }, result: 'milestone_complete: step done' }),
      stepCount: 10,
      zoneCrossings: [],
    });
    const pis = calculatePIS(ctx, 'Build web app with build_tool');
    expect(pis.recommendedAction).toBe('continue');
  });

  it('recommends abort for very low score', () => {
    const ctx = makeCtx({
      stepCount: 20,
      toolCallHistory: [
        { name: 'web_fetch', args: {}, result: 'random' },
        { name: 'browser_navigate', args: {}, result: 'random' },
        { name: 'exec_command', args: {}, result: 'random' },
      ],
      zoneCrossings: Array(10).fill({ from: 'smart', to: 'dumb' }),
    });
    const pis = calculatePIS(ctx, 'Build a web app');
    expect(pis.recommendedAction).toBe('abort');
  });

  it('classifies improving trend', () => {
    const ctx = makeCtx({
      stepCount: 12,
      pisHistory: [
        { step: 3, score: 0.3 },
        { step: 6, score: 0.4 },
        { step: 9, score: 0.6 },
        { step: 12, score: 0.8 },
      ],
    });
    const pis = calculatePIS(ctx, 'Build a web app');
    expect(pis.trend).toBe('improving');
  });

  it('classifies lost trend', () => {
    const ctx = makeCtx({
      stepCount: 12,
      pisHistory: [
        { step: 3, score: 0.8 },
        { step: 6, score: 0.6 },
        { step: 9, score: 0.4 },
        { step: 12, score: 0.2 },
      ],
    });
    const pis = calculatePIS(ctx, 'Build a web app');
    expect(pis.trend).toBe('lost');
  });
});
