import { ToolLoopAgent, type ToolSet } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ToolDependencies } from '../tools/tool-dependencies.js';
import { createSdkTools } from './tools.js';
import { buildInstructions } from './context.js';
import { runnerHooks } from './hooks.js';

function resolveModel(modelId: string): any {
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

export function createSecretaryAgent(deps: ToolDependencies, modelId: string): ToolLoopAgent {
  return new ToolLoopAgent({
    model: resolveModel(modelId),
    instructions: buildInstructions('secretary'),
    tools: createSdkTools(deps) as unknown as ToolSet,
    onStepEnd: runnerHooks.onStepEnd,
    onEnd: runnerHooks.onEnd,
  });
}
