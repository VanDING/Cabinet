import type { LLMGateway, LLMCallOptions, LLMResponse, StreamChunk, ToolDefinition } from './llm-gateway.js';

interface ProviderConfig {
  anthropic?: { apiKey: string };
  openai?: { apiKey: string };
  google?: { apiKey: string };
}

/**
 * Vercel AI SDK adapter with multi-provider support.
 * Resolves provider-qualified model names (e.g. "anthropic/claude-sonnet-4-6")
 * to AI SDK model objects using @ai-sdk/anthropic and @ai-sdk/openai.
 * Falls back to environment variables for API keys when not provided in config.
 */
export class AISDKAdapter implements LLMGateway {
  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
    const { generateText: aiGenerateText } = await this.importAISDK();

    const model = this.resolveModelObj(options.model);

    const messages = options.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    const result = await aiGenerateText({
      model,
      system: options.systemPrompt,
      messages: messages as any,
      maxTokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      tools: options.tools ? this.convertTools(options.tools) : undefined,
    });

    return {
      content: result.text ?? '',
      toolCalls: result.toolCalls?.map((tc: any) => ({
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
    const { streamText: aiStreamText } = await this.importAISDK();
    const model = this.resolveModelObj(options.model);

    const result = aiStreamText({
      model,
      system: options.systemPrompt,
      messages: options.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      maxTokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
    });

    for await (const chunk of result.textStream) {
      yield { type: 'text', content: chunk };
    }
    yield { type: 'done' };
  }

  async listModels(): Promise<string[]> {
    return [
      'anthropic/claude-opus-4-7',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-haiku-4-5',
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
    ];
  }

  /**
   * Resolve a model string like "anthropic/claude-sonnet-4-6" or "claude-sonnet-4-6"
   * to an AI SDK model object. Uses environment variables for API keys as fallback.
   */
  private resolveModelObj(modelName: string): any {
    // Default to Anthropic if no provider prefix
    const provider = modelName.includes('/')
      ? modelName.split('/')[0]!
      : 'anthropic';
    const name = modelName.includes('/')
      ? modelName.split('/').slice(1).join('/')
      : modelName;

    switch (provider) {
      case 'anthropic': {
        const key =
          this.config.anthropic?.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!key) throw new Error('ANTHROPIC_API_KEY not configured');
        const { anthropic } = this.loadProvider('anthropic');
        const client = anthropic({ apiKey: key });
        return client(name);
      }
      case 'openai': {
        const key =
          this.config.openai?.apiKey ?? process.env.OPENAI_API_KEY;
        if (!key) throw new Error('OPENAI_API_KEY not configured');
        const { openai } = this.loadProvider('openai');
        const client = openai({ apiKey: key });
        return client(name);
      }
      case 'google': {
        const key =
          this.config.google?.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!key) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not configured');
        // Google uses a different SDK, return the model name string directly
        // as the AI SDK's google provider handles model resolution internally
        return modelName;
      }
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Dynamically load a provider SDK. Falls back gracefully if not installed.
   */
  private loadProvider(provider: 'anthropic' | 'openai' | 'google'): any {
    try {
      switch (provider) {
        case 'anthropic':
          return require('@ai-sdk/anthropic');
        case 'openai':
          return require('@ai-sdk/openai');
        case 'google':
          try {
            return require('@ai-sdk/google');
          } catch {
            throw new Error(
              '@ai-sdk/google is not installed. Install it with: pnpm add @ai-sdk/google'
            );
          }
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not installed')) {
        throw error;
      }
      throw new Error(
        `@ai-sdk/${provider} is not installed. Install it with: pnpm add @ai-sdk/${provider}`
      );
    }
  }

  private async importAISDK(): Promise<any> {
    return import('ai');
  }

  private convertTools(tools: ToolDefinition[]): any {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}
