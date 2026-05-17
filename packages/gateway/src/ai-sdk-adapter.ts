import type {
  LLMGateway,
  LLMCallOptions,
  LLMResponse,
  StreamChunk,
  ToolDefinition,
  EmbeddingOptions,
  EmbeddingResult,
} from './llm-gateway.js';

interface ProviderConfig {
  [provider: string]: { apiKey: string; baseUrl?: string } | undefined;
  anthropic?: { apiKey: string };
  openai?: { apiKey: string };
  google?: { apiKey: string };
}

// Domestic LLM provider configurations (all OpenAI-compatible)
const DOMESTIC_PROVIDERS: Record<string, { baseURL: string }> = {
  deepseek: { baseURL: 'https://api.deepseek.com' },
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  moonshot: { baseURL: 'https://api.moonshot.cn/v1' },
  zhipu: { baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  baichuan: { baseURL: 'https://api.baichuan-ai.com/v1' },
};

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

    const model = await this.resolveModelObj(options.model);

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
    const model = await this.resolveModelObj(options.model);

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
      'openai/gpt-4-turbo',
      'google/gemini-2.0-flash',
      'google/gemini-2.0-pro',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-reasoner',
      'deepseek/deepseek-v3',
      'deepseek/deepseek-r1',
      'qwen/qwen-turbo',
      'qwen/qwen-plus',
      'qwen/qwen-max',
      'moonshot/moonshot-v1-8k',
      'moonshot/moonshot-v1-32k',
      'moonshot/moonshot-v1-128k',
      'zhipu/glm-4',
      'zhipu/glm-4-flash',
      'baichuan/baichuan4',
      'baichuan/baichuan3-turbo',
    ];
  }

  async generateEmbeddings(options: EmbeddingOptions): Promise<EmbeddingResult> {
    const { embed } = await this.importAISDK();
    const model = await this.resolveEmbeddingModel(options.model ?? 'text-embedding-3-small');

    const result = await embed({
      model,
      values: options.texts,
    });

    return {
      embeddings: result.embeddings.map((e: any) => Array.from(e)),
      model: options.model ?? 'text-embedding-3-small',
      usage: { tokens: result.usage?.tokens ?? 0 },
    };
  }

  /**
   * Resolve a model string like "anthropic/claude-sonnet-4-6" or "claude-sonnet-4-6"
   * to an AI SDK model object. Uses environment variables for API keys as fallback.
   */
  private PROVIDER_DEFAULTS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4o',
    google: 'gemini-2.0-flash',
    deepseek: 'deepseek-chat',
    qwen: 'qwen-plus',
    moonshot: 'moonshot-v1-8k',
    zhipu: 'glm-4',
    baichuan: 'baichuan4',
  };

  /** Find the first provider that has an API key configured */
  private firstConfiguredProvider(): string {
    const order = [
      'anthropic',
      'openai',
      'google',
      'deepseek',
      'qwen',
      'moonshot',
      'zhipu',
      'baichuan',
    ];
    for (const p of order) {
      if (this.config[p]?.apiKey ?? process.env[`${p.toUpperCase()}_API_KEY`]) return p;
    }
    return 'anthropic';
  }

  private async resolveModelObj(modelName: string): Promise<any> {
    const provider = modelName.includes('/')
      ? modelName.split('/')[0]!
      : this.firstConfiguredProvider();
    let name = modelName.includes('/') ? modelName.split('/').slice(1).join('/') : modelName;

    // If the model name doesn't look like it belongs to this provider, use the provider's default
    if (!modelName.includes('/') && provider !== 'anthropic' && name.startsWith('claude')) {
      name = this.PROVIDER_DEFAULTS[provider] ?? name;
    }

    switch (provider) {
      case 'anthropic': {
        const key = this.config.anthropic?.apiKey ?? process.env.ANTHROPIC_API_KEY;
        if (!key) throw new Error('ANTHROPIC_API_KEY not configured');
        const { createAnthropic } = await this.loadProvider('anthropic');
        const factory = createAnthropic({ apiKey: key });
        return factory(name);
      }
      case 'openai': {
        const key = this.config.openai?.apiKey ?? process.env.OPENAI_API_KEY;
        if (!key) throw new Error('OPENAI_API_KEY not configured');
        const { createOpenAI } = await this.loadProvider('openai');
        const factory = createOpenAI({ apiKey: key });
        return factory(name);
      }
      case 'google': {
        const key = this.config.google?.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!key) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not configured');
        const { google } = await this.loadProvider('google');
        const factory = google({ apiKey: key });
        return factory(name);
      }
      case 'deepseek':
      case 'qwen':
      case 'moonshot':
      case 'zhipu':
      case 'baichuan': {
        const providerConfig = DOMESTIC_PROVIDERS[provider]!;
        const key =
          this.config[provider]?.apiKey ?? process.env[`${provider.toUpperCase()}_API_KEY`];
        if (!key) throw new Error(`${provider.toUpperCase()}_API_KEY not configured`);
        const { createOpenAI } = await this.loadProvider('openai');
        const factory = createOpenAI({ apiKey: key, baseURL: providerConfig.baseURL });
        return factory(name);
      }
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Resolve an embedding model name to an AI SDK embedding model object.
   * Currently only OpenAI is supported for embeddings.
   */
  private async resolveEmbeddingModel(modelName: string): Promise<any> {
    const key = this.config.openai?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not configured for embeddings');
    const { openai } = await this.loadProvider('openai');
    const client = openai({ apiKey: key });
    return client.embedding(modelName);
  }

  /**
   * Dynamically load a provider SDK via ESM import(). Falls back gracefully if not installed.
   */
  private async loadProvider(provider: 'anthropic' | 'openai' | 'google'): Promise<any> {
    const pkgMap: Record<string, string> = {
      anthropic: '@ai-sdk/anthropic',
      openai: '@ai-sdk/openai',
      google: '@ai-sdk/google',
    };
    const pkg = pkgMap[provider]!;
    try {
      return await import(pkg);
    } catch (error) {
      const msg = (error as Error).message;
      if (
        msg.includes('Cannot find') ||
        msg.includes('not installed') ||
        msg.includes('not found') ||
        msg.includes('not installed')
      ) {
        throw new Error(`${pkg} is not installed. Install it with: pnpm add ${pkg}`);
      }
      throw error;
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
