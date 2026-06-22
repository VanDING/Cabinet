import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ToolDependencies } from '../tools/tool-dependencies.js';
import { createSdkTools } from './tools.js';
import { buildInstructions } from './context.js';
import { runnerHooks } from './hooks.js';

function resolveModel(modelId: string) {
  const [provider, ...nameParts] = modelId.split('/');
  const name = nameParts.length > 0 ? nameParts.join('/') : modelId;
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

export interface RunOptions {
  modelId: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  deps: ToolDependencies;
  maxSteps?: number;
}

export async function runAgent(opts: RunOptions) {
  const { modelId, system, messages, deps, maxSteps } = opts;
  const result = await (generateText as any)({
    model: resolveModel(modelId),
    system,
    messages,
    tools: createSdkTools(deps),
    maxSteps: maxSteps ?? 50,
    onStepFinish: runnerHooks.onStepFinish,
    onFinish: runnerHooks.onFinish,
  });
  return { content: result.text, steps: result.steps?.length ?? 1, toolCalls: result.steps ?? [] };
}
