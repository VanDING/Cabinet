import { describe, it, expect, vi } from 'vitest';
import { JudgeObserver } from '../observers/judge.js';
import type { AgentExecutionContext } from '../observer-pipeline.js';
import type { LLMGateway } from '@cabinet/gateway';

function makeGateway(verdict: string): LLMGateway {
  return {
    generateText: vi.fn().mockResolvedValue({
      content: `{"accuracy":80,"completeness":75,"helpfulness":70,"safety":95,"overall":80,"issues":[],"verdict":"${verdict}"}`,
      usage: { promptTokens: 10, completionTokens: 10, cachedPromptTokens: 0 },
      model: 'test',
    }),
    streamText: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
    generateEmbeddings: vi
      .fn()
      .mockResolvedValue({ embeddings: [], model: 'test', usage: { tokens: 0 } }),
  } as any;
}

function makeCtx(): AgentExecutionContext {
  return {
    sessionId: 's1',
    projectId: 'p1',
    captainId: 'c1',
    model: 'test',
    messages: [{ role: 'user', content: 'test query' }],
    systemPrompt: '',
    stepCount: 1,
    consecutiveErrors: 0,
    zoneCounts: { smart: 0, warning: 0, critical: 0, dumb: 0 },
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
    finalContent: 'final answer here',
    startTime: Date.now(),
  };
}

describe('JudgeObserver', () => {
  it('evaluates output on stream end', async () => {
    const gateway = makeGateway('pass');
    const observer = new JudgeObserver({ enabled: true, sampleRate: 1.0, taskFilter: [] }, gateway);
    const ctx = makeCtx();
    await observer.onStreamEnd!(ctx);
    expect(gateway.generateText).toHaveBeenCalled();
    expect((ctx as any).lastJudgeVerdict).toBeDefined();
    expect((ctx as any).lastJudgeVerdict.overall).toBe(80);
  });

  it('skips evaluation when sample rate misses', async () => {
    const gateway = makeGateway('pass');
    const observer = new JudgeObserver({ enabled: true, sampleRate: 0.0, taskFilter: [] }, gateway);
    const ctx = makeCtx();
    await observer.onStreamEnd!(ctx);
    expect(gateway.generateText).not.toHaveBeenCalled();
  });

  it('filters by task type', async () => {
    const gateway = makeGateway('pass');
    const observer = new JudgeObserver(
      { enabled: true, sampleRate: 1.0, taskFilter: ['code'] },
      gateway,
      'analysis',
    );
    const ctx = makeCtx();
    await observer.onStreamEnd!(ctx);
    expect(gateway.generateText).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    const gateway = makeGateway('pass');
    const observer = new JudgeObserver(
      { enabled: false, sampleRate: 1.0, taskFilter: [] },
      gateway,
    );
    const ctx = makeCtx();
    await observer.onStreamEnd!(ctx);
    expect(gateway.generateText).not.toHaveBeenCalled();
  });
});
