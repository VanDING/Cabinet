import type { AgentRoleType, StreamingCallback } from '@cabinet/agent';
import type { SecretaryAgent } from '@cabinet/secretary';
import type { ServerContext } from '../../../context.js';
import { broadcast } from '../../../ws/handler.js';
import { dispatchToSpecialistStreaming } from '../agents.js';
import type { SkillInvokeContext } from './skills.js';

export function handleTargetAgentStreaming(
  ctx: ServerContext,
  params: {
    targetAgent: string;
    message: string;
    augmentedMessage: string;
    sessionId: string;
    projectId: string;
    captainId: string;
    model: string | null | undefined;
    thinkingBudget?: number;
    interactive?: boolean;
  },
): Response {
  const {
    targetAgent,
    message,
    augmentedMessage,
    sessionId,
    projectId,
    captainId,
    model,
    thinkingBudget,
    interactive,
  } = params;

  const sseStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      function emit(type: string, data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type, ...data })}

`),
        );
      }
      let streamedContent = '';
      try {
        ctx.sessionManager.addMessage(sessionId, 'user', message);
        emit('status', { message: 'Thinking...' });
        await dispatchToSpecialistStreaming(
          targetAgent as AgentRoleType,
          augmentedMessage,
          sessionId,
          projectId,
          captainId,
          {
            onChunk(content: string) {
              streamedContent += content;
              emit('chunk', { content });
            },
            onThinking(content: string) {
              emit('thinking', { content });
            },
            onThinkingDone() {
              emit('thinking_done', {});
            },
            onToolCall(name: string, args: Record<string, unknown>) {
              emit('tool_status', {
                message: `Using tool: ${name}...`,
                toolType: 'call',
                detail: { name, args },
              });
            },
            onToolResult(name: string, result: unknown) {
              emit('tool_status', {
                message: `Tool completed: ${name}`,
                toolType: 'result',
                detail: { name, result },
              });
            },
            onUsage(usage: { promptTokens: number; completionTokens: number }) {
              ctx.costTracker.record(
                model ?? 'claude-sonnet-4-6',
                usage.promptTokens,
                usage.completionTokens,
              );
              emit('usage', {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
              });
            },
            onDone() {},
            onError(error: string) {
              emit('error', { message: error });
            },
          },
          thinkingBudget,
          model ?? undefined,
          interactive,
        );
        ctx.metrics.increment('llm_call', {
          model: model ?? 'claude-sonnet-4-6',
          purpose: 'chat',
        });
        broadcast('secretary_message', {
          sessionId,
          projectId,
          captainId,
          mode: 'single',
        });
        try {
          broadcast('cost_updated', {
            daily: ctx.costTracker.getDailyCost(),
            model: model ?? 'claude-sonnet-4-6',
            timestamp: new Date().toISOString(),
          });
        } catch {
          /* non-fatal */
        }
        ctx.sessionManager.addMessage(sessionId, 'assistant', streamedContent);
        emit('done', {
          sessionId,
          agentName: targetAgent,
          content: streamedContent,
          routed: false,
        });
      } catch (e) {
        emit('error', { message: (e as Error).message ?? 'Unknown error' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export function handleSecretaryStreaming(
  ctx: ServerContext,
  params: {
    agent: SecretaryAgent;
    agentLoop: import('@cabinet/agent').AgentLoop | null;
    message: string;
    augmentedMessage: string;
    sessionId: string;
    projectId: string;
    captainId: string;
    model: string | null | undefined;
    skillInvokeContext: SkillInvokeContext | null;
    thinkingBudget?: number;
  },
): Response {
  const {
    agent,
    agentLoop,
    message,
    augmentedMessage,
    sessionId,
    projectId,
    captainId,
    model,
    skillInvokeContext,
    thinkingBudget,
  } = params;

  const sseStream = new ReadableStream({
    async start(controller) {
      // Quality review tracking — keeps SSE open until review completes or times out
      let resolveQualityReview: (() => void) | null = null;
      const qualityReviewPromise = new Promise<void>((resolve) => {
        resolveQualityReview = resolve;
      });

      const encoder = new TextEncoder();
      function emit(type: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
      }
      try {
        emit('status', { message: 'Thinking...' });

        let streamedContent = '';

        const streamingCb: StreamingCallback = {
          onRoutingStart(targetAgent: string) {
            emit('routing_start', { targetAgent });
          },
          onChunk(content: string) {
            streamedContent += content;
            emit('chunk', { content });
          },
          onThinking(content: string) {
            emit('thinking', { content });
          },
          onThinkingDone() {
            emit('thinking_done', {});
          },
          onToolCall(name: string, args: Record<string, unknown>) {
            emit('tool_status', {
              message: `Using tool: ${name}...`,
              toolType: 'call',
              detail: { name, args },
            });
          },
          onToolResult(name: string, result: unknown) {
            emit('tool_status', {
              message: `Tool completed: ${name}`,
              toolType: 'result',
              detail: { name, result },
            });
          },
          onTaskUpdate(tasks: unknown[]) {
            emit('task_status', { tasks });
          },
          onSemanticTaskUpdate(tasks: unknown[]) {
            emit('semantic_task_status', { tasks });
          },
          onStepBudgetWarning(remaining: number, maxSteps: number) {
            emit('step_budget_warning', { remaining, maxSteps });
          },
          onUsage(usage: { promptTokens: number; completionTokens: number }) {
            ctx.costTracker.record(
              model ?? 'claude-sonnet-4-6',
              usage.promptTokens,
              usage.completionTokens,
            );
            emit('usage', {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
            });
          },
          onSubAgentStart(agentName: string, taskDescription: string) {
            emit('sub_agent_start', { agentName, taskDescription });
          },
          onSubAgentToolCall(agentName: string, toolName: string, args: Record<string, unknown>) {
            emit('sub_agent_tool_call', { agentName, toolName, args });
          },
          onSubAgentThinking(agentName: string, content: string) {
            emit('sub_agent_thinking', { agentName, content });
          },
          onSubAgentDone(agentName: string, result: string) {
            emit('sub_agent_done', { agentName, result });
          },
          onSubAgentError(agentName: string, error: string) {
            emit('sub_agent_error', { agentName, error });
          },
          onDone(fullContent: string) {
            streamedContent = fullContent;
          },
          onQualityReview(result: { pass: boolean; score: number; issues: unknown[] }) {
            emit('quality_review', {
              pass: result.pass,
              score: result.score,
              issues: result.issues,
            });
            resolveQualityReview?.();
          },
          onError(error: string) {
            emit('error', { message: error });
          },
        };

        let streamResult: {
          routeResult?: { targetAgent: string; confidence: number; reasoning: string };
          response: string;
        };
        if (skillInvokeContext && agentLoop) {
          const result = await agentLoop.runStreaming(skillInvokeContext.args, streamingCb);
          streamResult = {
            response: result.content,
            routeResult: {
              targetAgent: 'secretary',
              confidence: 1,
              reasoning: `Direct skill invocation: ${skillInvokeContext.skillName}`,
            },
          };
        } else {
          streamResult = await agent.handleMessageStreaming(
            sessionId,
            augmentedMessage,
            streamingCb,
          );
        }

        const targetAgent = streamResult.routeResult?.targetAgent ?? 'secretary';
        const isRouted = targetAgent !== 'secretary';

        // Emit routing info BEFORE done (so client receives it before closing the stream)
        if (streamResult.routeResult && isRouted) {
          emit('routing', {
            targetAgent,
            confidence: streamResult.routeResult.confidence,
            reasoning: streamResult.routeResult.reasoning,
          });
        }

        // Emit done last — client stops reading here, so routing must come first
        ctx.metrics.increment('llm_call', {
          model: model ?? 'claude-sonnet-4-6',
          purpose: 'chat',
        });
        broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'single' });
        try {
          broadcast('cost_updated', {
            daily: ctx.costTracker.getDailyCost(),
            model: model ?? 'claude-sonnet-4-6',
            timestamp: new Date().toISOString(),
          });
        } catch {
          /* non-fatal */
        }
        emit('done', {
          sessionId,
          agentName: targetAgent,
          content: streamedContent,
          routed: isRouted,
          ...(streamResult.routeResult
            ? {
                targetAgent,
                confidence: streamResult.routeResult.confidence,
                reasoning: streamResult.routeResult.reasoning,
              }
            : {}),
        });
      } catch (e) {
        emit('error', { message: (e as Error).message ?? 'Unknown error' });
      } finally {
        // Wait for async quality review before closing (max 5s)
        await Promise.race([
          qualityReviewPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);
        controller.close();
      }
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
