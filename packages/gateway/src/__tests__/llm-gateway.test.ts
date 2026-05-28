import { describe, it, expect } from 'vitest';
import type { LLMGateway, LLMCallOptions, LLMResponse, StreamChunk } from '../llm-gateway.js';
import { AISDKAdapter } from '../ai-sdk-adapter.js';

// Test with a mock since we don't want real API calls in tests
class MockLLMGateway implements LLMGateway {
  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
    return {
      content: `Mock response to: ${options.messages[options.messages.length - 1]?.content ?? ''}`,
      usage: { promptTokens: 10, completionTokens: 5, cachedPromptTokens: 0 },
      model: options.model,
    };
  }

  async *streamText(options: LLMCallOptions): AsyncIterable<StreamChunk> {
    yield { type: 'text', content: 'Hello' };
    yield { type: 'text', content: ' World' };
    yield { type: 'done' };
  }

  async listModels(): Promise<string[]> {
    return ['test-model'];
  }

  async generateEmbeddings(options: { texts: string[] }): Promise<any> {
    return {
      embeddings: options.texts.map(() => [0.1, 0.2, 0.3]),
      model: 'mock-embed',
      usage: { tokens: options.texts.length * 10 },
    };
  }
}

describe('LLMGateway interface', () => {
  it('generateText returns structured response', async () => {
    const gateway = new MockLLMGateway();
    const response = await gateway.generateText({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(response.content).toContain('Mock response');
    expect(response.usage.promptTokens).toBe(10);
    expect(response.usage.completionTokens).toBe(5);
  });

  it('streamText yields chunks', async () => {
    const gateway = new MockLLMGateway();
    const chunks: StreamChunk[] = [];
    for await (const chunk of gateway.streamText({
      model: 'test',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1]!.type).toBe('done');
  });

  it('listModels returns model names', async () => {
    const gateway = new MockLLMGateway();
    const models = await gateway.listModels();
    expect(models).toContain('test-model');
  });

  it('generateEmbeddings returns vectors', async () => {
    const gateway = new MockLLMGateway();
    const result = await gateway.generateEmbeddings({ texts: ['hello', 'world'] });
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]!).toHaveLength(3);
  });
});

describe('AISDKAdapter construction', () => {
  it('can be constructed with provider config', () => {
    const adapter = new AISDKAdapter({ anthropic: { apiKey: 'test-key' } });
    expect(adapter).toBeInstanceOf(AISDKAdapter);
  });

  it('can be constructed with multiple providers', () => {
    const adapter = new AISDKAdapter({
      anthropic: { apiKey: 'anthro-key' },
      openai: { apiKey: 'openai-key' },
    });
    expect(adapter).toBeInstanceOf(AISDKAdapter);
  });

  it('satisfies LLMGateway interface', () => {
    const adapter: LLMGateway = new AISDKAdapter({});
    expect(adapter).toBeDefined();
  });

  it('listModels returns provider-qualified names', async () => {
    const adapter = new AISDKAdapter({ anthropic: { apiKey: 'test-key' } });
    const models = await adapter.listModels();
    expect(models).toContain('anthropic/claude-sonnet-4-6');
    expect(models).toContain('openai/gpt-4o');
  });
});
