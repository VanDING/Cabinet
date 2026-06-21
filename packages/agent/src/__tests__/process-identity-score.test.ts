import { describe, it, expect } from 'vitest';
import { calculatePIS } from '../process-identity-score.js';
import { EmbeddingService } from '../embedding-service.js';
import type { AgentExecutionContext } from '../observer-pipeline.js';
import type {
  LLMGateway,
  LLMStreamOptions,
  StreamChunk,
  EmbeddingOptions,
  EmbeddingResult,
} from '@cabinet/gateway';
import { streamFromGenerate } from './helpers/mock-gateway.js';

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
  it('returns stable trend for single evaluation', async () => {
    const ctx = makeCtx();
    const pis = await calculatePIS(ctx, 'Build a web app');
    expect(pis.total).toBeGreaterThanOrEqual(0);
    expect(pis.total).toBeLessThanOrEqual(1);
    expect(pis.trend).toBe('stable');
    expect(pis.factors.length).toBe(4);
  });

  it('detects low tool coherence with many different tools', async () => {
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
    const pis = await calculatePIS(ctx, 'Build a web app');
    const tc = pis.factors.find((f) => f.name === 'toolCoherence');
    expect(tc!.score).toBe(0);
  });

  it('detects high tool coherence with same tool', async () => {
    const ctx = makeCtx({
      toolCallHistory: Array(10).fill({ name: 'read_file', args: {}, result: '' }),
    });
    const pis = await calculatePIS(ctx, 'Build a web app');
    const tc = pis.factors.find((f) => f.name === 'toolCoherence');
    expect(tc!.score).toBe(0.9); // 1 unique / 10 total = 0.9
  });

  it('goal progress detects milestone markers', async () => {
    const ctx = makeCtx({
      toolCallHistory: [
        { name: 'read_file', args: {}, result: 'milestone_complete: API created' },
        { name: 'write_file', args: {}, result: 'subtask_done: auth module' },
        { name: 'edit_file', args: {}, result: 'goal_achieved: deployed' },
      ],
    });
    const pis = await calculatePIS(ctx, 'Build a web app');
    const gp = pis.factors.find((f) => f.name === 'goalProgress');
    expect(gp!.score).toBeGreaterThan(0.5);
  });

  it('goal progress is neutral without markers', async () => {
    const ctx = makeCtx({
      toolCallHistory: [
        { name: 'read_file', args: {}, result: 'some content' },
        { name: 'write_file', args: {}, result: 'done' },
      ],
    });
    const pis = await calculatePIS(ctx, 'Build a web app');
    const gp = pis.factors.find((f) => f.name === 'goalProgress');
    expect(gp!.score).toBe(0.5);
  });

  it('recommends continue for high score', async () => {
    const ctx = makeCtx({
      // Use the same tool many times for high coherence
      toolCallHistory: Array(10).fill({
        name: 'build_tool',
        args: { app: 'web' },
        result: 'milestone_complete: step done',
      }),
      stepCount: 10,
      zoneCrossings: [],
    });
    const pis = await calculatePIS(ctx, 'Build web app with build_tool');
    expect(pis.recommendedAction).toBe('continue');
  });

  it('recommends abort for very low score', async () => {
    const ctx = makeCtx({
      stepCount: 20,
      toolCallHistory: [
        { name: 'web_fetch', args: {}, result: 'random' },
        { name: 'browser_navigate', args: {}, result: 'random' },
        { name: 'exec_command', args: {}, result: 'random' },
      ],
      zoneCrossings: Array(10).fill({ from: 'smart', to: 'dumb' }),
    });
    const pis = await calculatePIS(ctx, 'Build a web app');
    expect(pis.recommendedAction).toBe('abort');
  });

  it('classifies improving trend', async () => {
    const ctx = makeCtx({
      stepCount: 12,
      pisHistory: [
        { step: 3, score: 0.3 },
        { step: 6, score: 0.4 },
        { step: 9, score: 0.6 },
        { step: 12, score: 0.8 },
      ],
    });
    const pis = await calculatePIS(ctx, 'Build a web app');
    expect(pis.trend).toBe('improving');
  });

  it('classifies lost trend', async () => {
    const ctx = makeCtx({
      stepCount: 12,
      pisHistory: [
        { step: 3, score: 0.8 },
        { step: 6, score: 0.6 },
        { step: 9, score: 0.4 },
        { step: 12, score: 0.2 },
      ],
    });
    const pis = await calculatePIS(ctx, 'Build a web app');
    expect(pis.trend).toBe('lost');
  });

  it('embedding mode: semantically similar task+tools → high alignment', async () => {
    const mockGateway: LLMGateway = {
      async generateText() {
        return { content: '', usage: { promptTokens: 0, completionTokens: 0 }, model: 'test' };
      },
      async *streamText(options: LLMStreamOptions): AsyncGenerator<StreamChunk> {
        yield* streamFromGenerate(this.generateText.bind(this), options);
      },
      async listModels() {
        return ['test'];
      },
      async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
        // Deterministic mock: same text → same embedding, different text → orthogonal embedding
        const text = _options.texts[0] ?? '';
        if (text.includes('web') || text.includes('react') || text.includes('app')) {
          return { embeddings: [[1, 0, 0]], model: 'test', usage: { tokens: 1 } };
        }
        if (text.includes('database') || text.includes('sql')) {
          return { embeddings: [[0, 1, 0]], model: 'test', usage: { tokens: 1 } };
        }
        return { embeddings: [[0, 0, 1]], model: 'test', usage: { tokens: 1 } };
      },
    };
    const embeddingService = new EmbeddingService(mockGateway);

    const ctx = makeCtx({
      toolCallHistory: [
        { name: 'create_react_app', args: { template: 'typescript' }, result: '' },
        { name: 'write_file', args: { path: 'src/App.tsx' }, result: '' },
      ],
    });
    const pis = await calculatePIS(ctx, 'Build a web application', embeddingService);
    const ia = pis.factors.find((f) => f.name === 'intentAlignment');
    expect(ia!.score).toBeGreaterThan(0.7);
  });

  it('fallback to keyword when embedding unavailable', async () => {
    const ctx = makeCtx({
      toolCallHistory: [{ name: 'create_react_app', args: { template: 'typescript' }, result: '' }],
    });
    const pis = await calculatePIS(ctx, 'Build a web application');
    const ia = pis.factors.find((f) => f.name === 'intentAlignment');
    // Keyword Jaccard should still produce a reasonable score
    expect(ia!.score).toBeGreaterThanOrEqual(0);
    expect(ia!.score).toBeLessThanOrEqual(1);
  });
});
