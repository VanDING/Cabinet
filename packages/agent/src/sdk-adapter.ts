import { ToolLoopAgent, isStepCount } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createSdkTools } from './tools-wrapper.js';
import type { ToolDependencies } from './tools/tool-dependencies.js';

export interface AgentLoopAdapterResult {
  content: string;
  steps: number;
  toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AgentLoopStreamingCallback {
  onChunk?: (content: string) => void;
  onThinking?: (content: string) => void;
  onDone?: (content: string) => void;
  onError?: (error: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void;
}

export interface SdkAgentLoopAdapterConfig {
  instructions: string;
  model?: string;
  temperature?: number;
  maxResponseTokens?: number;
  maxSteps?: number;
  allowedTools?: string[];
}

function resolveProvider(modelId: string) {
  const [provider, ...nameParts] = modelId.split('/');
  const name = nameParts.join('/') || modelId;
  switch (provider) {
    case 'deepseek':
      return createDeepSeek()(name);
    case 'anthropic':
      return createAnthropic()(name);
    case 'openai':
      return createOpenAI()(name);
    default:
      return createDeepSeek()(name);
  }
}

/**
 * Wraps ToolLoopAgent in the old AgentLoop run/runStreaming interface.
 * Transitional bridge — consumers don't need to change.
 */
export class SdkAgentLoopAdapter {
  private agent: ToolLoopAgent<any, any>;

  constructor(
    private deps: ToolDependencies,
    private config: SdkAgentLoopAdapterConfig,
  ) {
    const sdkTools = this.buildFilteredTools();
    this.agent = new ToolLoopAgent<any, any>({
      model: resolveProvider(config.model || 'deepseek/deepseek-chat'),
      instructions: config.instructions,
      tools: sdkTools,
      stopWhen: isStepCount(config.maxSteps ?? 50),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      ...(config.maxResponseTokens !== undefined
        ? { maxOutputTokens: config.maxResponseTokens }
        : {}),
    });
  }

  private buildFilteredTools(): Record<string, unknown> {
    const allTools = createSdkTools(this.deps);
    if (!this.config.allowedTools || this.config.allowedTools.length === 0) {
      return allTools;
    }
    const filtered: Record<string, unknown> = {};
    for (const [name, toolDef] of Object.entries(allTools)) {
      if (this.config.allowedTools.includes(name)) {
        filtered[name] = toolDef;
      }
    }
    return filtered;
  }

  async run(message: string): Promise<AgentLoopAdapterResult> {
    const result = await (this.agent.generate as any)({ prompt: message });

    return {
      content: result.text ?? '',
      steps: result.steps?.length ?? 1,
      toolCalls: extractToolCalls(result.steps ?? []),
      usage: result.usage
        ? {
            promptTokens: result.usage.promptTokens ?? result.usage.prompt ?? 0,
            completionTokens: result.usage.completionTokens ?? result.usage.completion ?? 0,
          }
        : undefined,
    };
  }

  async runStreaming(
    message: string,
    callback: AgentLoopStreamingCallback,
  ): Promise<AgentLoopAdapterResult> {
    const streamResult = await (this.agent.stream as any)({ prompt: message });
    let fullContent = '';

    try {
      for await (const chunk of streamResult.textStream) {
        fullContent += chunk;
        callback.onChunk?.(chunk);
      }
    } catch (err) {
      callback.onError?.((err as Error).message);
    }

    callback.onDone?.(fullContent);

    const steps = streamResult.steps ?? [];
    const usage = streamResult.usage;

    return {
      content: fullContent,
      steps: steps.length ?? 1,
      toolCalls: extractToolCalls(steps),
      usage: usage
        ? {
            promptTokens: usage.promptTokens ?? usage.prompt ?? 0,
            completionTokens: usage.completionTokens ?? usage.completion ?? 0,
          }
        : undefined,
    };
  }
}

function extractToolCalls(
  steps: any[],
): { name: string; args: Record<string, unknown>; result: unknown }[] {
  const toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[] = [];
  for (const step of steps || []) {
    const calls = step.toolCalls || [];
    for (const tc of calls) {
      toolCalls.push({
        name: tc.toolName || tc.name,
        args: (tc.input || tc.args) as Record<string, unknown>,
        result: tc.result ?? tc.output,
      });
    }
    // Map tool results to corresponding tool calls
    const results = step.toolResults || [];
    for (let i = 0; i < results.length && i < calls.length; i++) {
      const idx = toolCalls.length - results.length + i;
      if (toolCalls[idx]) {
        toolCalls[idx].result = results[i].result ?? results[i].output;
      }
    }
  }
  return toolCalls;
}
