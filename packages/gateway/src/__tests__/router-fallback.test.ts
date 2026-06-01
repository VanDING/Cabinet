import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRouter, type ModelRole } from '../model-router.js';
import { FallbackChain } from '../fallback.js';
import type { LLMGateway, LLMCallOptions, LLMResponse } from '../llm-gateway.js';

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  it('returns primary model for deep_think role', () => {
    expect(router.getModel('deep_think')).toBe('anthropic/claude-opus-4-7');
  });

  it('returns primary model for fast_execute role', () => {
    expect(router.getModel('fast_execute')).toBe('anthropic/claude-haiku-4-5');
  });

  it('returns primary model for default role', () => {
    expect(router.getModel('default')).toBe('anthropic/claude-sonnet-4-6');
  });

  it('returns fallbacks excluding primary', () => {
    const fallbacks = router.getFallbacks('deep_think');
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toBe('anthropic/claude-sonnet-4-6');
  });

  it('returns full model chain', () => {
    const chain = router.getModelChain('deep_think');
    expect(chain).toHaveLength(2);
    expect(chain[0]).toBe('anthropic/claude-opus-4-7');
    expect(chain[1]).toBe('anthropic/claude-sonnet-4-6');
  });

  it('allows custom configuration', () => {
    router.setRoleModels('default', ['custom-model']);
    expect(router.getModel('default')).toBe('custom-model');
  });

  it('falls back to default role for unknown role', () => {
    const customRouter = new ModelRouter({
      roles: { default: ['fallback-model'] } as any,
    });
    // @ts-expect-error testing invalid role
    expect(customRouter.getModel('nonexistent')).toBe('fallback-model');
  });
});

describe('FallbackChain', () => {
  it('succeeds on first model', async () => {
    const mockGateway: LLMGateway = {
      async generateText(options: LLMCallOptions): Promise<LLMResponse> {
        return {
          content: `Response from ${options.model}`,
          usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
          model: options.model,
        };
      },
      async *streamText() {
        yield { type: 'done' };
      },
      async listModels() {
        return [];
      },
      async generateEmbeddings() {
        return { embeddings: [], model: 'mock', usage: { tokens: 0 } };
      },
    };

    const chain = new FallbackChain({
      gateway: mockGateway,
      router: new ModelRouter(),
      timeoutMs: 5000,
    });

    const response = await chain.generateText({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(response.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('falls back when first model times out', async () => {
    let callCount = 0;
    const mockGateway: LLMGateway = {
      async generateText(options: LLMCallOptions): Promise<LLMResponse> {
        callCount++;
        if (options.model === 'model-a') {
          // Simulate timeout by hanging
          await new Promise(() => {}); // will never resolve
        }
        return {
          content: `Response from ${options.model}`,
          usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
          model: options.model,
        };
      },
      async *streamText() {
        yield { type: 'done' };
      },
      async listModels() {
        return [];
      },
      async generateEmbeddings() {
        return { embeddings: [], model: 'mock', usage: { tokens: 0 } };
      },
    };

    const router = new ModelRouter();
    router.setRoleModels('default', ['model-a', 'model-b']);

    const fallbackLog: string[] = [];
    const chain = new FallbackChain({
      gateway: mockGateway,
      router,
      timeoutMs: 100, // short timeout
      maxRetries: 1,
      onFallback: (from, to) => fallbackLog.push(`${from}→${to}`),
    });

    const response = await chain.generateText({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(response.model).toBe('model-b');
    expect(fallbackLog).toHaveLength(1);
    expect(fallbackLog[0]).toBe('model-a→model-b');
  });

  it('retries same model maxRetries times before falling back', async () => {
    const callOrder: string[] = [];
    const mockGateway: LLMGateway = {
      async generateText(options: LLMCallOptions): Promise<LLMResponse> {
        callOrder.push(options.model);
        if (callOrder.filter((m) => m === 'model-a').length <= 2) {
          throw new Error('Transient error');
        }
        return {
          content: `Response from ${options.model}`,
          usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
          model: options.model,
        };
      },
      async *streamText() { yield { type: 'done' }; },
      async listModels() { return []; },
      async generateEmbeddings() { return { embeddings: [], model: 'mock', usage: { tokens: 0 } }; },
    };

    const router = new ModelRouter();
    router.setRoleModels('default', ['model-a', 'model-b']);

    const chain = new FallbackChain({
      gateway: mockGateway,
      router,
      maxRetries: 2,
      timeoutMs: 5000,
    });

    const response = await chain.generateText({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // model-a should be tried 3 times (original + 2 retries), then succeed
    expect(callOrder.filter((m) => m === 'model-a')).toHaveLength(3);
    expect(response.model).toBe('model-a');
  });

  it('falls back to next model after retries exhausted', async () => {
    const callOrder: string[] = [];
    const mockGateway: LLMGateway = {
      async generateText(options: LLMCallOptions): Promise<LLMResponse> {
        callOrder.push(options.model);
        if (options.model === 'model-a') throw new Error('Persistent error');
        return {
          content: `Response from ${options.model}`,
          usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0 },
          model: options.model,
        };
      },
      async *streamText() { yield { type: 'done' }; },
      async listModels() { return []; },
      async generateEmbeddings() { return { embeddings: [], model: 'mock', usage: { tokens: 0 } }; },
    };

    const router = new ModelRouter();
    router.setRoleModels('default', ['model-a', 'model-b']);
    const fallbackLog: string[] = [];

    const chain = new FallbackChain({
      gateway: mockGateway,
      router,
      maxRetries: 1,
      timeoutMs: 5000,
      onFallback: (from, to) => fallbackLog.push(`${from}→${to}`),
    });

    const response = await chain.generateText({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // model-a tried 2 times (original + 1 retry), then falls back to model-b
    expect(callOrder.filter((m) => m === 'model-a')).toHaveLength(2);
    expect(callOrder).toContain('model-b');
    expect(response.model).toBe('model-b');
    expect(fallbackLog).toHaveLength(1);
  });

  it('throws when all models exhausted', async () => {
    const mockGateway: LLMGateway = {
      async generateText(): Promise<LLMResponse> {
        throw new Error('Service unavailable');
      },
      async *streamText() {
        yield { type: 'done' };
      },
      async listModels() {
        return [];
      },
      async generateEmbeddings() {
        return { embeddings: [], model: 'mock', usage: { tokens: 0 } };
      },
    };

    const router = new ModelRouter();
    router.setRoleModels('default', ['model-a']);

    const chain = new FallbackChain({
      gateway: mockGateway,
      router,
      maxRetries: 0,
    });

    await expect(
      chain.generateText({ messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.toThrow('All models exhausted');
  });
});
