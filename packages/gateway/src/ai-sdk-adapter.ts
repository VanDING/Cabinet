import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText as aiGenerateText, streamText as aiStreamText, embed, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { ModelRouter } from './model-router.js';
import type { ModelRole } from './model-router.js';
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
  deepseek?: ProviderEntry;
  qwen?: ProviderEntry;
  moonshot?: ProviderEntry;
  zhipu?: ProviderEntry;
  baichuan?: ProviderEntry;
}

export type ModelTier = 'deep_reasoning' | 'fast_execution' | 'default';

export interface ModelMapping {
  [tier: string]: string | undefined;
  deep_reasoning?: string;
  fast_execution?: string;
  default?: string;
}

// OpenAI-compatible provider base URLs (used by createOpenAICompatible fallback)
const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  baichuan: 'https://api.baichuan-ai.com/v1',
};

/**
 * Vercel AI SDK adapter with multi-provider support.
 * Resolves model tier strings (e.g. "deep_reasoning") to provider/model
 * via user-configurable modelMapping, falling back to raw model names.
 */
/** Map ModelTier (used by agent-roles) to ModelRole (used by ModelRouter). */
const TIER_TO_ROLE: Record<string, ModelRole> = {
  deep_reasoning: 'deep_think',
  fast_execution: 'fast_execute',
  default: 'default',
};

export class AISDKAdapter implements LLMGateway {
  private readonly config: ProviderConfig;
  private modelMapping: ModelMapping;
  private router: ModelRouter;

  constructor(config: ProviderConfig, modelMapping?: ModelMapping) {
    this.config = config;
    this.modelMapping = modelMapping ?? {};
    // Build router fallbacks from user's modelMapping: each user-mapped model becomes
    // the primary model for that role with DEFAULT_CONFIG as fallback chain
    const userFallbacks: Partial<Record<ModelRole, string[]>> = {};
    if (modelMapping) {
      for (const [tier, model] of Object.entries(modelMapping)) {
        if (model) {
          const role = TIER_TO_ROLE[tier];
          if (role) {
            userFallbacks[role] = [model];
          }
        }
      }
    }
    this.router = new ModelRouter(undefined, userFallbacks);
  }

  /** Update model mapping at runtime (called when user changes settings). */
  setModelMapping(mapping: ModelMapping): void {
    this.modelMapping = mapping;
    // Rebuild router fallbacks
    const userFallbacks: Partial<Record<ModelRole, string[]>> = {};
    for (const [tier, model] of Object.entries(mapping)) {
      if (model) {
        const role = TIER_TO_ROLE[tier];
        if (role) {
          userFallbacks[role] = [model];
        }
      }
    }
    this.router = new ModelRouter(undefined, userFallbacks);
  }

  /** Resolve a model tier to the actual provider/model string. */
  resolveModelString(tier: string): string {
    // User-configured model takes priority first
    if (this.modelMapping[tier]) return this.modelMapping[tier];
    // Fall back to ModelRouter defaults
    const role = TIER_TO_ROLE[tier];
    if (role) return this.router.getModel(role);
    return tier;
  }

  /** Get the fallback chain for a model tier (for retry logic). */
  getModelChain(tier: string): string[] {
    const role = TIER_TO_ROLE[tier];
    if (role) return this.router.getModelChain(role);
    return [tier];
  }

  async generateText(options: LLMCallOptions): Promise<LLMResponse> {
    const model = await this.resolveModelObj(options.model);

    const messages = options.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // Build system prompt with cache control for Anthropic models
    const system = this.buildSystemPrompt(options);

    const result = await aiGenerateText({
      model,
      system,
      messages: messages as any,
      ...(options.maxTokens != null ? { maxOutputTokens: options.maxTokens } : {}),
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      tools: options.tools ? this.convertTools(options.tools) : undefined,
    } as any);

    return {
      content: result.text ?? '',
      toolCalls: result.toolCalls?.map((tc: any) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: (tc.input ?? tc.args) as Record<string, unknown>,
      })),
      usage: {
        promptTokens: result.usage?.inputTokens ?? 0,
        completionTokens: result.usage?.outputTokens ?? 0,
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
          inputSchema: zodSchema,
          execute: td.execute as any,
        }) as any;
      }
    }

    // Build system prompt with cache control for Anthropic models
    const system = this.buildSystemPrompt(options);

    const result = aiStreamText({
      model,
      system,
      messages: messages as any,
      ...(options.maxTokens != null ? { maxOutputTokens: options.maxTokens } : {}),
      ...(options.temperature != null ? { temperature: options.temperature } : {}),
      ...(options.thinkingBudget != null ? { thinking: { type: 'enabled', budgetTokens: options.thinkingBudget } } : {}),
      tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
      stopWhen: stepCountIs(options.maxSteps ?? 50),
    } as any);

    let fullText = '';
    let thinkingDone = false;
    let nextTextNeedsBreak = false;
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'reasoning-delta') {
          const rd = part as { type: 'reasoning-delta'; text: string };
          yield { type: 'thinking', content: rd.text };
        } else if (part.type === 'reasoning-start') {
          // reasoning phase begins
        } else if (part.type === 'reasoning-end') {
          yield { type: 'thinking_done' };
          thinkingDone = true;
        } else if (part.type === 'text-delta') {
          // First text delta signals thinking is done if not already signaled
          if (!thinkingDone) {
            thinkingDone = true;
            yield { type: 'thinking_done' };
          }
          const td = part as { type: 'text-delta'; text: string };
          if (nextTextNeedsBreak) {
            nextTextNeedsBreak = false;
            fullText += '\n\n';
          }
          fullText += td.text;
          yield { type: 'text', content: td.text };
        } else if (part.type === 'tool-call') {
          const tc = part as { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown };
          yield {
            type: 'tool_call',
            toolCall: {
              id: tc.toolCallId,
              name: tc.toolName,
              args: tc.input as Record<string, unknown>,
            },
          };
        } else if (part.type === 'tool-result') {
          nextTextNeedsBreak = true;
          const tr = part as { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown };
          yield {
            type: 'tool_result',
            toolResult: {
              id: tr.toolCallId,
              name: tr.toolName,
              result: tr.output,
            },
          };
        }
      }
    } catch (e) {
      yield { type: 'error', content: (e as Error).message };
    }
    let usage: { promptTokens: number; completionTokens: number } | undefined;
    try {
      const u = await result.usage;
      usage = { promptTokens: u?.inputTokens ?? 0, completionTokens: u?.outputTokens ?? 0 };
    } catch {
      // usage not available for this provider/model
    }
    yield { type: 'done', content: fullText, usage };
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
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-chat',     // deprecated 2026/07/24 → v4-flash non-thinking
      'deepseek/deepseek-reasoner', // deprecated 2026/07/24 → v4-flash thinking
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
    deepseek: 'deepseek-v4-pro',
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
      case 'deepseek': {
        const key = this.config.deepseek?.apiKey ?? process.env.DEEPSEEK_API_KEY;
        if (!key) throw new Error('DEEPSEEK_API_KEY not configured');
        const baseURL = this.config.deepseek?.baseUrl;
        const deepseek = createDeepSeek({
          apiKey: key,
          ...(baseURL ? { baseURL } : {}),
        });
        return deepseek(name);
      }
      case 'qwen':
      case 'moonshot':
      case 'zhipu':
      case 'baichuan': {
        const defaultBaseURL = OPENAI_COMPATIBLE_BASE_URLS[provider]!;
        const key =
          this.config[provider]?.apiKey ?? process.env[`${provider.toUpperCase()}_API_KEY`];
        if (!key) throw new Error(`${provider.toUpperCase()}_API_KEY not configured`);
        const baseURL = this.config[provider]?.baseUrl ?? defaultBaseURL;
        const client = createOpenAICompatible({ name: provider, apiKey: key, baseURL });
        return client(name);
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

  /** Determine if the model name resolves to an Anthropic provider. */
  private isAnthropicModel(modelName: string): boolean {
    const lower = modelName.toLowerCase();
    return lower.startsWith('anthropic/') || lower.includes('claude');
  }

  /**
   * Build the system prompt parameter for AI SDK.
   * When cacheSystemPrompt is enabled and the model is Anthropic,
   * returns a SystemModelMessage with cacheControl provider metadata.
   */
  private buildSystemPrompt(options: LLMCallOptions): string | { role: 'system'; content: string; providerOptions: Record<string, unknown> } | undefined {
    if (!options.systemPrompt) return undefined;
    if (options.cacheSystemPrompt && this.isAnthropicModel(options.model)) {
      return {
        role: 'system',
        content: options.systemPrompt,
        providerOptions: {
          anthropic: {
            cacheControl: { type: 'ephemeral' },
          },
        },
      };
    }
    return options.systemPrompt;
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
      let obj = Object.keys(shape).length > 0 ? z.object(shape, {}) : z.record(z.string(), z.any());
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
