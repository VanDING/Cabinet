import type { LLMGateway, LLMResponse, StreamingToolDefinition } from '@cabinet/gateway';
import { withRetry } from '../retry.js';
import { ToolExecutor } from '../tool-executor.js';
import { CheckpointManager } from '../checkpoint.js';
import {
  ObserverPipeline,
  type AgentEvent,
  type AgentExecutionContext,
} from '../observer-pipeline.js';
import type { TrustLevel } from '@cabinet/types';
import { TRUST_THRESHOLDS, type AgentLoopOptions } from './agent-loop-options.js';

import { READ_ONLY_TOOLS } from '../tool-categories.js';

/** Execute a tool call with a timeout. Used in both parallel and sequential execution paths. */
function executeToolWithTimeout(
  executor: ToolExecutor,
  name: string,
  id: string,
  args: Record<string, unknown>,
  opts: { sessionId: string; trustLevel?: TrustLevel; toolTimeoutMs?: number },
): Promise<import('../tool-executor.js').ToolResult> {
  return Promise.race([
    executor.execute(name, id, args, {
      sessionId: opts.sessionId,
      trustLevel: opts.trustLevel ?? 'T1',
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Tool '${name}' timed out`)),
        opts.toolTimeoutMs ?? 300_000,
      ),
    ),
  ]);
}

/** Shared helper: check observer pipeline results for blocked signals. */
function findBlocked(results: unknown[]): { blocked: boolean; reason?: string } | undefined {
  return results.find(
    (r): r is { blocked: boolean; reason?: string } =>
      r !== null && typeof r === 'object' && (r as Record<string, unknown>).blocked === true,
  );
}

export interface ExecuteGeneratorDependencies {
  options: AgentLoopOptions;
  gateway: LLMGateway;
  observerPipeline: ObserverPipeline;
  toolExecutor: ToolExecutor;
  checkpointManager: CheckpointManager;
  resolveToolExecutor: (
    taskDescription?: string,
    recentMessages?: Array<{ role: string; content: string }>,
  ) => Promise<ToolExecutor>;
}

export async function* executeGenerator(
  deps: ExecuteGeneratorDependencies,
  userMessage: string,
  ctx: AgentExecutionContext,
  _streamingCallback?: unknown,
): AsyncGenerator<AgentEvent> {
  const {
    options,
    gateway,
    observerPipeline: pipeline,
    resolveToolExecutor,
    checkpointManager,
  } = deps;
  const maxSteps = options.maxSteps ?? 50;
  const trust = TRUST_THRESHOLDS[options.trustLevel ?? 'T1'];

  await pipeline.notify('onStreamStart', ctx);

  // Check user input for injection attempts (P0-2)
  const inputChecks = await pipeline.notify('onUserInput', ctx, userMessage);
  const blocked = findBlocked(inputChecks);
  if (blocked) {
    ctx.finalContent = `[BLOCKED] ${blocked.reason ?? 'Input blocked by content guard'}`;
    yield { type: 'done', content: ctx.finalContent, steps: 0, toolCalls: [] };
    await pipeline.notify('onStreamEnd', ctx);
    return;
  }

  // Resolve tools
  const activeToolExecutor = await resolveToolExecutor(options.taskDescription, ctx.messages);
  const toolDescriptors = activeToolExecutor.getToolDescriptors();

  // Main execution loop
  while (ctx.stepCount < maxSteps) {
    if (ctx.consecutiveErrors >= trust.maxConsecutiveErrors) {
      ctx.finalContent = `Agent stopped after ${ctx.consecutiveErrors} consecutive errors (trust level: ${options.trustLevel ?? 'T1'}).`;
      break;
    }

    ctx.currentStepText = '';
    ctx.currentStepToolCalls = [];

    // Inject mid-session Blackboard updates before next LLM call
    if (ctx.pendingBlackboardUpdates && ctx.pendingBlackboardUpdates.length > 0) {
      const updates = ctx.pendingBlackboardUpdates;
      const lines = updates.map(
        (u) =>
          `- [BLACKBOARD UPDATE @${new Date().toISOString()}] ${u.topic}: ${JSON.stringify(u.payload).slice(0, 300)}`,
      );
      ctx.messages.push({
        role: 'user',
        content: '[Shared Context Update]\n' + lines.join('\n'),
      });
      ctx.pendingBlackboardUpdates = [];
    }

    // Inject subconscious insights at the start of a new reasoning cycle
    if (ctx.pendingSubconsciousInsights && ctx.pendingSubconsciousInsights.length > 0) {
      const insights = ctx.pendingSubconsciousInsights;
      const lines = insights.map(
        (insight) => `- ${insight.text} (relevance ${(insight.relevance * 100).toFixed(0)}%)`,
      );
      ctx.messages.push({
        role: 'user',
        content: '[Subconscious Insight]\n' + lines.join('\n'),
      });
      ctx.pendingSubconsciousInsights = [];
    }

    // LLM call
    let response: LLMResponse;
    try {
      response = await withRetry(
        () =>
          gateway.generateText({
            model: options.model ?? 'claude-sonnet-4-6',
            systemPrompt: ctx.systemPrompt,
            messages: ctx.messages,
            tools: toolDescriptors,
            cacheSystemPrompt: true,
            ...(options.maxResponseTokens != null ? { maxTokens: options.maxResponseTokens } : {}),
            ...(options.temperature != null ? { temperature: options.temperature } : {}),
          }),
        new Error('LLM call'),
      );
    } catch (error) {
      ctx.errorCounts.fatal++;
      ctx.consecutiveErrors++;
      ctx.finalContent = `Agent loop failed at step ${ctx.stepCount}: ${(error as Error).message}`;
      break;
    }

    ctx.totalPromptTokens += response.usage?.promptTokens ?? 0;
    ctx.totalCompletionTokens += response.usage?.completionTokens ?? 0;

    if (options.costTracker && response.usage) {
      options.costTracker.record(
        response.model,
        response.usage.promptTokens,
        response.usage.completionTokens,
        response.usage.cachedPromptTokens ?? 0,
      );
    }

    // Final response (no tool calls)
    if (!response.toolCalls || response.toolCalls.length === 0) {
      ctx.finalContent = response.content;
      ctx.messages.push({ role: 'assistant', content: response.content });
      if (ctx.handoff) {
        ctx.handoff.recordDecision(response.content.slice(0, 200), 'agent final response');
      }

      // Simulate streaming for UI
      for (let i = 0; i < response.content.length; i += 4) {
        yield { type: 'text', content: response.content.slice(i, i + 4) };
        if (_streamingCallback) await new Promise((r) => setTimeout(r, 8));
      }

      ctx.stepCount++;
      const stepResults = await pipeline.notify('onStepEnd', ctx);
      const shouldContinue = stepResults.some(
        (r) => r !== null && typeof r === 'object' && (r as any).handoff === true,
      );
      if (shouldContinue) {
        ctx.currentStepText = '';
        ctx.currentStepToolCalls = [];
        continue;
      }
      break;
    }

    // Tool calls present
    ctx.messages.push({ role: 'assistant', content: response.content });
    ctx.currentStepToolCalls = response.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      args: tc.arguments,
    }));

    const toolResults: { role: 'user'; content: string }[] = [];
    const allReadOnly = response.toolCalls.every((tc) => READ_ONLY_TOOLS.has(tc.name));

    if (allReadOnly) {
      // Parallel execution for read-only tools
      const pending = response.toolCalls.map(async (tc) => {
        const safetyResults = await pipeline.notify(
          'onToolCall',
          { id: tc.id, name: tc.name, args: tc.arguments },
          ctx,
        );
        const blocked = findBlocked(safetyResults);
        if (blocked) {
          const blockedResult = `BLOCKED: ${blocked.reason}`;
          await pipeline.notify(
            'onToolResult',
            { id: tc.id, name: tc.name, args: tc.arguments },
            blockedResult,
            ctx,
          );
          return {
            role: 'user' as const,
            content: `Tool result for ${tc.name}: ${blockedResult}`,
            event: {
              type: 'tool_result' as const,
              id: tc.id,
              name: tc.name,
              result: blockedResult,
            },
          };
        }
        const execResult = await executeToolWithTimeout(
          activeToolExecutor,
          tc.name,
          tc.id,
          tc.arguments,
          options,
        );
        const result = execResult.error ?? execResult.output;
        await pipeline.notify(
          'onToolResult',
          { id: tc.id, name: tc.name, args: tc.arguments },
          result,
          ctx,
        );
        return {
          role: 'user' as const,
          content: `Tool result for ${tc.name}: ${JSON.stringify(result)}`,
          event: { type: 'tool_result' as const, id: tc.id, name: tc.name, result },
        };
      });
      const outcomes = await Promise.all(pending);
      for (const tc of response.toolCalls) {
        yield { type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments };
      }
      for (const outcome of outcomes) {
        yield outcome.event;
        toolResults.push({ role: outcome.role, content: outcome.content });
      }
    } else {
      for (const tc of response.toolCalls) {
        yield { type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments };

        const safetyResults = await pipeline.notify(
          'onToolCall',
          { id: tc.id, name: tc.name, args: tc.arguments },
          ctx,
        );
        const blocked = findBlocked(safetyResults);

        if (blocked) {
          const blockedResult = `BLOCKED: ${blocked.reason}`;
          yield { type: 'tool_result', id: tc.id, name: tc.name, result: blockedResult };
          await pipeline.notify(
            'onToolResult',
            { id: tc.id, name: tc.name, args: tc.arguments },
            blockedResult,
            ctx,
          );
          toolResults.push({
            role: 'user',
            content: `Tool result for ${tc.name}: ${blockedResult}`,
          });
          continue;
        }

        let result: unknown;
        try {
          const execResult = await executeToolWithTimeout(
            activeToolExecutor,
            tc.name,
            tc.id,
            tc.arguments,
            options,
          );
          result = execResult.error ?? execResult.output;
        } catch (timeoutError) {
          checkpointManager.save({
            sessionId: options.sessionId,
            step: ctx.stepCount,
            messages: ctx.messages,
            toolCallHistory: ctx.toolCallHistory,
            metadata: { projectId: options.projectId, crashed: true },
          });
          throw timeoutError;
        }

        yield { type: 'tool_result', id: tc.id, name: tc.name, result };
        await pipeline.notify(
          'onToolResult',
          { id: tc.id, name: tc.name, args: tc.arguments },
          result,
          ctx,
        );
        toolResults.push({
          role: 'user',
          content: `Tool result for ${tc.name}: ${JSON.stringify(result)}`,
        });
      }
    }

    ctx.messages.push(...toolResults);
    ctx.stepCount++;

    const stepResults = await pipeline.notify('onStepEnd', ctx);
    const shouldHandoff = stepResults.some(
      (r) => r !== null && typeof r === 'object' && (r as any).handoff === true,
    );
    if (shouldHandoff) {
      continue;
    }
  }

  // Stream end
  await pipeline.notify('onStreamEnd', ctx);

  yield {
    type: 'done',
    content: ctx.finalContent,
    steps: ctx.stepCount,
    toolCalls: ctx.toolCallHistory,
  };
}
