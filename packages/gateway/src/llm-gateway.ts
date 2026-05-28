export interface LLMCallOptions {
  model: string;
  systemPrompt?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  /** Anthropic extended thinking budget in tokens (1024–128000). */
  thinkingBudget?: number;
  /** Cache the system prompt (Anthropic cache_control). Reduces token cost for multi-step loops. */
  cacheSystemPrompt?: boolean;
  /** Cache the first N messages as a prefix (Anthropic cache_control on message boundary). */
  cachePrefixMessages?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCallResult[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    /** Number of prompt tokens served from cache (billed at lower rate). */
    cachedPromptTokens: number;
  };
  model: string;
}

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'thinking' | 'thinking_done';
  content?: string;
  toolCall?: { name: string; args: Record<string, unknown>; id: string };
  toolResult?: { name: string; result: unknown; id: string };
  /** Token usage, populated on 'done' chunks. */
  usage?: { promptTokens: number; completionTokens: number; cachedPromptTokens: number };
  /** Number of LLM tool rounds consumed, populated on 'done' chunks. */
  steps?: number;
}

/** Tool definition with execute function for streaming */
export interface StreamingToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Extended options for streaming LLM calls with tool support */
export interface LLMStreamOptions extends LLMCallOptions {
  tools?: StreamingToolDefinition[];
  maxSteps?: number;
}

export interface EmbeddingOptions {
  texts: string[];
  model?: string;
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  usage: { tokens: number };
}

export interface LLMGateway {
  generateText(options: LLMCallOptions): Promise<LLMResponse>;
  streamText(options: LLMStreamOptions): AsyncIterable<StreamChunk>;
  listModels(): Promise<string[]>;
  generateEmbeddings(options: EmbeddingOptions): Promise<EmbeddingResult>;
}
