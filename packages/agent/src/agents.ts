import { ToolLoopAgent, Output, isStepCount } from 'ai';
import { z } from 'zod';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createSdkTools } from './tools-wrapper.js';
import { buildInstructions, prepareStep } from './context.js';
import type { ToolDependencies } from './tools/tool-dependencies.js';

export function createSecretaryAgent(deps: ToolDependencies): ToolLoopAgent<any, any> {
  const sdkTools = createSdkTools(deps);

  return new ToolLoopAgent({
    model: createDeepSeek()('deepseek-chat'),
    instructions: buildInstructions('secretary'),
    tools: sdkTools,
    stopWhen: isStepCount(50),
    prepareStep,

    onStepEnd: async ({ stepNumber, usage, finishReason, toolCalls }) => {
      // TODO: checkpoint save, observability
    },

    onToolExecutionStart: async ({ toolCall, toolContext }) => {
      // TODO: safety check integration
    },

    onEnd: async ({ steps, usage }) => {
      // TODO: session report
    },
  });
}

export function createCuratorAgent(deps: ToolDependencies): ToolLoopAgent<any, any> {
  const sdkTools = createSdkTools(deps);

  return new ToolLoopAgent({
    model: createDeepSeek()('deepseek-chat'),
    instructions: buildInstructions('curator'),
    tools: sdkTools,
    stopWhen: isStepCount(10),

    output: Output.object({
      schema: z.object({
        sessionBrief: z.string().describe('Session summary for LTM'),
        decisions: z.array(z.string()),
        nextActions: z.array(z.string()),
      }),
    }),
  });
}
