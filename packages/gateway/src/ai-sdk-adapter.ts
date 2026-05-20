import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText as aiGenerateText, streamText as aiStreamText, embed, tool } from 'ai';
import { z } from 'zod';
import type {
  LLMGateway,
  LLMCallOptions,
  LLMResponse,
  LLMStreamOptions,
  StreamChunk,
  StreamingToolDefinition,
  ToolDefinition,
  EmbeddingOptions,
  EmbeddingResult,
} from './llm-gateway.js';

export interface ProviderEntry {
  apiKey: string;
  baseUrl?: string;
}

export interface ProviderConfig {
  [provider: string]: ProviderEntry | undefined;
  anthropic?: ProviderEntry;
  openai?: ProviderEntry;
  google?: ProviderEntry;
}

export type ModelTier = 'deep_reasoning' | 'fast_execution' | 'default';

export interface ModelMapping {
  [tier: string]: string | undefined;
  deep_reasoning?: string;
  fast_execution?: string;
  default?: string;
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
 * Resolves model tier strings (e.g. "deep_reasoning") to provider/model
 * via user-configurable modelMapping, falling back to raw model names.
 */
export class AISDKAdapter implements LLMGateway {
  private readonly config: ProviderConfig;
  private modelMapping: ModelMapping;

  constructor(config: ProviderConfig, modelMapping?: ModelMapping) {
    this.config = config;
    this.modelMapping = modelMapping ?? {};
  }

  /** Update model mapping at runtime (called when user changes settings). */
  setModelMapping(mapping: ModelMapping): void {
    this.modelMapping = mapping;
  }

  /** Resolve a model tier to the actual provider/model string. */
  resolveModelString(tier: string): string {
    return this.modelMapping[tier] ?? tier;
  }

  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
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

  async *streamText(options: LLMStreamOptions): AsyncIterable<StreamChunk> {
    const model = await this.resolveModelObj(options.model);

    const messages = options.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Build AI SDK tool definitions from StreamingToolDefinition
    const aiTools: Record<string, any> = {};
    if (options.tools && options.tools.length > 0) {
      for (const td of options.tools) {
        const zodSchema = jsonSchemaToZod(td.parameters);
        aiTools[td.name] = tool({
          description: td.description,
          parameters: zodSchema,
          execute: td.execute,
        }) as any;
      }
    }

    const result = aiStreamText({
      model,
      system: options.systemPrompt,
      messages: messages as any,
      maxTokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
      tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
      maxSteps: options.maxSteps ?? 10,
    });

    let fullText = '';
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          const td = part as { textDelta: string };
          fullText += td.textDelta;
          yield { type: 'text', content: td.textDelta };
        } else if (part.type === 'tool-call') {
          const tc = part as { toolCallId: string; toolName: string; args: unknown };
          yield {
            type: 'tool_call',
            toolCall: {
              id: tc.toolCallId,
              name: tc.toolName,
              args: tc.args as Record<string, unknown>,
            },
          };
        } else if (part.type === 'step-finish') {
          // Tool execution completed — yield tool_result for each finished step
          const sf = part as { toolResults?: Array<{ toolCallId: string; toolName: string; result: unknown }> };
          if (sf.toolResults) {
            for (const tr of sf.toolResults) {
              yield {
                type: 'tool_result',
                toolResult: {
                  id: tr.toolCallId,
                  name: tr.toolName,
                  result: tr.result,
                },
              };
            }
          }
        }
      }
    } catch (e) {
      yield { type: 'error', content: (e as Error).message };
    }
    yield { type: 'done', content: fullText };
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
    const model = await this.resolveEmbeddingModel(options.model ?? 'text-embedding-3-small');

    const results = await Promise.all(
      options.texts.map((text) =>
        embed({ model, value: text }),
      ),
    );

    return {
      embeddings: results.map((r) => Array.from(r.embedding as Iterable<number>)),
      model: options.model ?? 'text-embedding-3-small',
      usage: { tokens: results.reduce((sum, r) => sum + (r.usage?.tokens ?? 0), 0) },
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
        const factory = createAnthropic({ apiKey: key });
        return factory(name);
      }
      case 'openai': {
        const key = this.config.openai?.apiKey ?? process.env.OPENAI_API_KEY;
        if (!key) throw new Error('OPENAI_API_KEY not configured');
        const baseURL = this.config.openai?.baseUrl;
        const factory = baseURL ? createOpenAI({ apiKey: key, baseURL }) : createOpenAI({ apiKey: key });
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
        // Use user-configured base_url if provided, otherwise fall back to default
        const baseURL = this.config[provider]?.baseUrl ?? providerConfig.baseURL;
        const factory = createOpenAI({ apiKey: key, baseURL });
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
    const client = createOpenAI({ apiKey: key });
    return client.embedding(modelName);
  }

  /**
   * Load a provider SDK. Anthropic and OpenAI are statically imported (bundled by esbuild).
   * Google is loaded dynamically since it's an optional dependency.
   */
  private async loadProvider(provider: 'anthropic' | 'openai' | 'google'): Promise<any> {
    switch (provider) {
      case 'anthropic':
        return { createAnthropic };
      case 'openai':
        return { createOpenAI };
      case 'google':
        // @ai-sdk/google is an optional dependency — load dynamically
        try {
          // @ts-expect-error — optional dependency, may not be installed
          return await import('@ai-sdk/google');
        } catch {
          throw new Error('@ai-sdk/google is not installed. Install it with: pnpm add @ai-sdk/google');
        }
    }
  }

  private convertTools(tools: ToolDefinition[]): any {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}

/** Convert a basic JSON Schema object to a Zod schema for AI SDK tool definitions. */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string | undefined;
  const description = schema.description as string | undefined;

  switch (type) {
    case 'string': {
      if (schema.enum) {
        const e = z.enum(schema.enum as [string, ...string[]]);
        return description ? e.describe(description) : e;
      }
      const s = z.string();
      return description ? s.describe(description) : s;
    }
    case 'number':
    case 'integer': {
      let n = z.number();
      if (description) n = n.describe(description);
      return n;
    }
    case 'boolean': {
      let b = z.boolean();
      if (description) b = b.describe(description);
      return b;
    }
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = new Set(schema.required as string[] ?? []);
      const shape: Record<string, z.ZodType> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        let zodProp = jsonSchemaToZod(propSchema);
        if (!required.has(key)) zodProp = zodProp.optional();
        shape[key] = zodProp;
      }
      let obj = Object.keys(shape).length > 0 ? z.object(shape) : z.record(z.any());
      if (description) obj = obj.describe(description);
      return obj;
    }
    case 'array': {
      const items = schema.items as Record<string, unknown> | undefined;
      let arr = z.array(items ? jsonSchemaToZod(items) : z.any());
      if (description) arr = arr.describe(description);
      return arr;
    }
    default:
      return z.any();
  }
}
