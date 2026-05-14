export interface LLMCallOptions {
  model: string;
  systemPrompt?: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
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
  };
  model: string;
}

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: Partial<ToolCallResult>;
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
  streamText(options: LLMCallOptions): AsyncIterable<StreamChunk>;
  listModels(): Promise<string[]>;
  generateEmbeddings(options: EmbeddingOptions): Promise<EmbeddingResult>;
}
