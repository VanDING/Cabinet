import { describe, it, expect, vi } from 'vitest';
import { ReflectionObserver } from '../observers/reflection.js';
import type { AgentExecutionContext } from '../observer-pipeline.js';
import type { LLMGateway } from '@cabinet/gateway';

function makeGateway(score: number): LLMGateway {
  return {
    generateText: vi.fn().mockResolvedValue({
      content: `{"score": ${score}, "issues": ["incomplete"]}}`,
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

function makeCtx(finalContent = 'test response'): AgentExecutionContext {
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
    finalContent,
    startTime: Date.now(),
  };
}

describe('ReflectionObserver', () => {
  it('returns handoff when quality is below threshold', async () => {
    const gateway = makeGateway(50);
    const observer = new ReflectionObserver(
      { enabled: true, maxRounds: 2, qualityThreshold: 70 },
      gateway,
    );
    const ctx = makeCtx();
    const result = await observer.onStepEnd(ctx);
    expect(result.handoff).toBe(true);
    expect(ctx.messages.some((m) => m.content.includes('Reflection triggered'))).toBe(true);
  });

  it('returns empty when quality is above threshold', async () => {
    const gateway = makeGateway(85);
    const observer = new ReflectionObserver(
      { enabled: true, maxRounds: 2, qualityThreshold: 70 },
      gateway,
    );
    const ctx = makeCtx();
    const result = await observer.onStepEnd(ctx);
    expect(result.handoff).toBeUndefined();
  });

  it('does nothing when disabled', async () => {
    const observer = new ReflectionObserver(
      { enabled: false, maxRounds: 2, qualityThreshold: 70 },
      makeGateway(50),
    );
    const ctx = makeCtx();
    const result = await observer.onStepEnd(ctx);
    expect(result).toEqual({});
  });

  it('does nothing for tool-call steps', async () => {
    const observer = new ReflectionObserver(
      { enabled: true, maxRounds: 2, qualityThreshold: 70 },
      makeGateway(50),
    );
    const ctx = makeCtx();
    ctx.currentStepToolCalls = [{ id: '1', name: 'read_file', args: {} }];
    const result = await observer.onStepEnd(ctx);
    expect(result).toEqual({});
  });

  it('stops after maxRounds', async () => {
    const gateway = makeGateway(50);
    const observer = new ReflectionObserver(
      { enabled: true, maxRounds: 1, qualityThreshold: 70 },
      gateway,
    );
    const ctx = makeCtx();
    // First round triggers handoff
    await observer.onStepEnd(ctx);
    // Second round should stop
    ctx.currentStepToolCalls = [];
    const result = await observer.onStepEnd(ctx);
    expect(result.handoff).toBeUndefined();
  });
});
