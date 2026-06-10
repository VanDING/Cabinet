import { describe, it, expect, vi } from 'vitest';
import { AutoReplanObserver } from '../observers/auto-replan.js';
import type { AgentExecutionContext } from '../observer-pipeline.js';
import type { LLMGateway } from '@cabinet/gateway';

function makeGateway(): LLMGateway {
  return {
    generateText: vi.fn().mockResolvedValue({
      content: 'The tool requires a different parameter format.',
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

function makeCtx(stepCount = 1): AgentExecutionContext {
  return {
    sessionId: 's1',
    projectId: 'p1',
    captainId: 'c1',
    model: 'test',
    messages: [],
    systemPrompt: '',
    stepCount,
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
    finalContent: '',
    startTime: Date.now(),
  };
}

describe('AutoReplanObserver', () => {
  it('accumulates errors and triggers replan', async () => {
    const gateway = makeGateway();
    const observer = new AutoReplanObserver(
      { enabled: true, errorThreshold: 2, maxReplanRounds: 2 },
      gateway,
    );

    const ctx = makeCtx(1);
    await observer.onToolResult(
      { id: '1', name: 'read_file', args: {} },
      'Error: file not found',
      ctx,
    );
    await observer.onToolResult(
      { id: '2', name: 'read_file', args: {} },
      'Error: file not found',
      ctx,
    );

    const result = await observer.onStepEnd(ctx);
    expect(result.handoff).toBe(true);
    expect(ctx.messages.some((m) => m.content.includes('Auto-replan triggered'))).toBe(true);
  });

  it('does not trigger below threshold', async () => {
    const observer = new AutoReplanObserver(
      { enabled: true, errorThreshold: 3, maxReplanRounds: 2 },
      makeGateway(),
    );
    const ctx = makeCtx(1);
    await observer.onToolResult(
      { id: '1', name: 'read_file', args: {} },
      'Error: file not found',
      ctx,
    );

    const result = await observer.onStepEnd(ctx);
    expect(result.handoff).toBeUndefined();
  });

  it('ignores successful results', async () => {
    const observer = new AutoReplanObserver(
      { enabled: true, errorThreshold: 1, maxReplanRounds: 2 },
      makeGateway(),
    );
    const ctx = makeCtx(1);
    await observer.onToolResult({ id: '1', name: 'read_file', args: {} }, 'file content here', ctx);

    const result = await observer.onStepEnd(ctx);
    expect(result.handoff).toBeUndefined();
  });

  it('does nothing when disabled', async () => {
    const observer = new AutoReplanObserver(
      { enabled: false, errorThreshold: 1, maxReplanRounds: 2 },
      makeGateway(),
    );
    const ctx = makeCtx(1);
    await observer.onToolResult({ id: '1', name: 'read_file', args: {} }, 'Error: fail', ctx);

    const result = await observer.onStepEnd(ctx);
    expect(result).toEqual({});
  });
});
