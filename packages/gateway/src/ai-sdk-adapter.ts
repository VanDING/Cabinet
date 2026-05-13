import type { LLMGateway, LLMCallOptions, LLMResponse, StreamChunk, ToolDefinition } from './llm-gateway.js';

/**
 * Vercel AI SDK 适配器。
 * 封装 AI SDK 的 generateText/streamText，使其符合 LLMGateway 接口。
 *
 * 支持 Anthropic, OpenAI, Google 等所有 AI SDK 兼容的提供商。
 */
export class AISDKAdapter implements LLMGateway {
  private readonly apiKey: string;
  private readonly defaultProvider: string;

  constructor(options: { apiKey: string; defaultProvider?: string }) {
    this.apiKey = options.apiKey;
    this.defaultProvider = options.defaultProvider ?? 'anthropic';
  }

  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
    // 使用 AI SDK v4 generateText
    const { generateText: aiGenerateText } = await import('ai');

    const result = await aiGenerateText({
      model: this.resolveModel(options.model),
      system: options.systemPrompt,
      messages: options.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      tools: options.tools ? this.convertTools(options.tools) : undefined,
    });

    return {
      content: result.text ?? '',
      toolCalls: result.toolCalls?.map(tc => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.args as Record<string, unknown>,
      })),
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
      },
      model: options.model,
    };
  }

  async *streamText(options: LLMCallOptions): AsyncIterable<StreamChunk> {
    const { streamText: aiStreamText } = await import('ai');

    const result = aiStreamText({
      model: this.resolveModel(options.model),
      system: options.systemPrompt,
      messages: options.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    });

    for await (const chunk of result.textStream) {
      yield { type: 'text', content: chunk };
    }
    yield { type: 'done' };
  }

  async listModels(): Promise<string[]> {
    return [
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'gpt-4o',
      'gpt-4o-mini',
      'gemini-2.5-pro',
    ];
  }

  private resolveModel(model: string): any {
    // AI SDK v4 uses provider.model pattern or direct string for default provider
    // Return model string directly — actual provider binding happens via env vars
    return model;
  }

  private convertTools(tools: ToolDefinition[]): any {
    return tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}
