import { describe, it, expect } from 'vitest';
import type { LLMGateway, LLMCallOptions, LLMResponse, StreamChunk } from '../llm-gateway.js';
import { AISDKAdapter } from '../ai-sdk-adapter.js';

// Test with a mock since we don't want real API calls in tests
class MockLLMGateway implements LLMGateway {
  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
    return {
      content: `Mock response to: ${options.messages[options.messages.length - 1]?.content ?? ''}`,
      usage: { promptTokens: 10, completionTokens: 5 },
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
});

describe('AISDKAdapter construction', () => {
  it('can be constructed with apiKey', () => {
    const adapter = new AISDKAdapter({ apiKey: 'test-key' });
    expect(adapter).toBeInstanceOf(AISDKAdapter);
  });

  it('satisfies LLMGateway interface', () => {
    const adapter: LLMGateway = new AISDKAdapter({ apiKey: 'test-key' });
    expect(adapter).toBeDefined();
  });
});
