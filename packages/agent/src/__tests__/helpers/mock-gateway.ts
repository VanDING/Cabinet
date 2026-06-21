import type {
  LLMGateway,
  LLMCallOptions,
  LLMResponse,
  LLMStreamOptions,
  StreamChunk,
  EmbeddingOptions,
  EmbeddingResult,
} from '@cabinet/gateway';

/**
 * Convert a generateText response into StreamChunk events.
 * Used by both createMockGateway and class-based mock gateways.
 */
export async function* streamFromGenerate(
  generateTextFn: (options: LLMCallOptions) => Promise<LLMResponse>,
  options: LLMStreamOptions,
): AsyncGenerator<StreamChunk> {
  const result = await generateTextFn(options);
  if (result.content) {
    yield { type: 'text', content: result.content };
  }
  if (result.toolCalls) {
    for (const tc of result.toolCalls) {
      yield {
        type: 'tool_call',
        toolCall: { id: tc.id, name: tc.name, args: tc.arguments },
      };
    }
  }
  yield {
    type: 'done',
    usage: {
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      cachedPromptTokens: 0,
    },
  };
}

/**
 * Build a mock LLMGateway from a single generateText function.
 * The streamText async generator internally calls generateText and
 * converts the response into StreamChunk events, so call counters and
 * branching logic inside generateText remain authoritative.
 */
export function createMockGateway(
  generateTextFn: (options: LLMCallOptions) => Promise<LLMResponse>,
  extra?: { embeddings?: EmbeddingResult; models?: string[] },
): LLMGateway {
  return {
    generateText: generateTextFn,
    async *streamText(options: LLMStreamOptions): AsyncGenerator<StreamChunk> {
      yield* streamFromGenerate(generateTextFn, options);
    },
    async listModels() {
      return extra?.models ?? ['test-model'];
    },
    async generateEmbeddings(_options: EmbeddingOptions): Promise<EmbeddingResult> {
      return extra?.embeddings ?? { embeddings: [], model: 'test-model', usage: { tokens: 0 } };
    },
  };
}
