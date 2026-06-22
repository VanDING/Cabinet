import { MessageType } from '@cabinet/types';
import type { AgentRoleType } from '@cabinet/agent';
import { OrganizeInteractiveAgent } from '@cabinet/agent';
import { getServerContext } from '../../../../context.js';
import { broadcast } from '../../../../ws/handler.js';
import { createStandardToolExecutor } from '../../../../agent-factory.js';
import { buildToolDependencies } from '../../tool-dependencies.js';
import {
  resolveModel,
  getAgentLoopForRole,
  createReviewerLoop,
  persistReviewResult,
} from '../agent-factory.js';
import { activeSubAgents } from './state.js';

/** Dispatch a message to a specialist role with streaming output. */
export async function dispatchToSpecialistStreaming(
  roleType: AgentRoleType,
  message: string,
  sessionId: string,
  projectId: string,
  captainId: string,
  callback: import('@cabinet/agent').StreamingCallback,
  thinkingBudget?: number,
  model?: string,
  interactive?: boolean,
): Promise<void> {
  const ctx = getServerContext();

  // ── Interactive mode for Organize agent ──
  if (interactive && roleType === 'organize') {
    const childSession = ctx.sessionManager.createChildSession(sessionId, roleType);
    const childSessionId = childSession.id;

    const resolveModel = (tier: string) => {
      try {
        const role = { modelTier: tier };
        const adapter = ctx.gateway as { resolveModelString?: (t: string) => string };
        if (adapter?.resolveModelString) {
          return adapter.resolveModelString(tier);
        }
        return tier;
      } catch {
        return tier;
      }
    };

    const toolExecutor = createStandardToolExecutor(
      ctx,
      buildToolDependencies(ctx, projectId === 'global' ? undefined : projectId, {
        getAgentLoopForRole,
        resolveModel,
      }),
    );
    const interactiveAgent = new OrganizeInteractiveAgent(ctx.gateway!, toolExecutor, resolveModel);

    // Register in active map
    activeSubAgents.set(childSessionId, {
      loop: null as unknown as import('@cabinet/agent').AgentLoop,
      interactive: interactiveAgent,
      parentSessionId: sessionId,
      roleType,
      status: 'running',
    });

    // Forward events from interactive agent to AgentEventBus + SSE callback
    interactiveAgent.onEvent.on('event', (event: import('@cabinet/events').AgentEvent) => {
      ctx.agentEventBus.publish(childSessionId, sessionId, event);
      if (event.type === 'stream_chunk') callback.onChunk?.(event.content);
      else if (event.type === 'thinking') callback.onThinking?.(event.content);
      else if (event.type === 'tool_call')
        callback.onToolCall?.(event.name, event.args as Record<string, unknown>);
      else if (event.type === 'tool_result') callback.onToolResult?.(event.name, event.result);
      else if (event.type === 'output') callback.onDone?.(event.content);
      else if (event.type === 'error') callback.onError?.(event.message);
      else if (event.type === 'status') {
        const mappedStatus = event.status === 'running' ? 'active' : event.status;
        ctx.sessionManager.updateStatus(childSessionId, mappedStatus);
        const entry = activeSubAgents.get(childSessionId);
        if (entry) entry.status = event.status;
      }
    });

    try {
      await interactiveAgent.init({
        sessionId: childSessionId,
        parentSessionId: sessionId,
        projectId,
        captainId,
        message,
        model: model ?? undefined,
      });
      const status = interactiveAgent.getStatus();
      const entry = activeSubAgents.get(childSessionId);
      if (entry) entry.status = status;
      callback.onDone?.('Blueprint ready for review');
    } catch (e) {
      callback.onError?.((e as Error).message ?? 'Unknown error');
      activeSubAgents.delete(childSessionId);
    }
    return;
  }

  const loop = getAgentLoopForRole(
    roleType,
    sessionId,
    projectId,
    captainId,
    thinkingBudget,
    model,
  );
  if (!loop) {
    callback.onError?.(`[No LLM] Cannot dispatch to ${roleType}.`);
    callback.onDone('');
    return;
  }

  // Create a child session for this sub-agent run
  const childSession = ctx.sessionManager.createChildSession(sessionId, roleType);
  const childSessionId = childSession.id;

  // Wrap callback to dual-track events via AgentEventBus
  const wrappedCallback: import('@cabinet/agent').StreamingCallback = {
    ...callback,
    onChunk(content) {
      callback.onChunk?.(content);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'stream_chunk',
        content,
        timestamp: Date.now(),
      });
    },
    onThinking(content) {
      callback.onThinking?.(content);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'thinking',
        content,
        timestamp: Date.now(),
      });
    },
    onToolCall(name, args) {
      callback.onToolCall?.(name, args);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'tool_call',
        name,
        args,
        timestamp: Date.now(),
      });
    },
    onToolResult(name, result) {
      callback.onToolResult?.(name, result);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'tool_result',
        name,
        result,
        timestamp: Date.now(),
      });
    },
    onDone(fullContent) {
      callback.onDone?.(fullContent);
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'output',
        content: fullContent,
        timestamp: Date.now(),
      });
    },
    onError(error) {
      callback.onError?.(error);
      ctx.sessionManager.updateStatus(childSessionId, 'error');
      ctx.agentEventBus.publish(childSessionId, sessionId, {
        type: 'error',
        message: error,
        timestamp: Date.now(),
      });
      activeSubAgents.delete(childSessionId);
    },
  };

  // Publish start event
  ctx.agentEventBus.publish(childSessionId, sessionId, {
    type: 'started',
    timestamp: Date.now(),
  });

  // Register in active map so mid-flight input can reach this loop
  activeSubAgents.set(childSessionId, {
    loop,
    parentSessionId: sessionId,
    roleType,
    status: 'running',
  });

  try {
    const result = await loop.runStreaming(message, wrappedCallback);
    ctx.sessionManager.updateStatus(childSessionId, 'completed');
    ctx.sessionManager.setDeliverable(childSessionId, {
      agentType: roleType,
      content: result.content,
      toolCalls: result.toolCalls,
    });
    ctx.agentEventBus.publish(childSessionId, sessionId, {
      type: 'completed',
      deliverable: result.content,
      timestamp: Date.now(),
    });
    // Keep in active map until explicitly finalized (or auto-finalize after a timeout)
    // For now, leave it so user can still send "regenerate" if desired.
    // Async quality review after streaming completes (does not block the stream)
    if (roleType !== 'secretary') {
      const reviewerLoop = createReviewerLoop(ctx);
      if (reviewerLoop) {
        const reviewContent =
          result.content.length > 8000
            ? result.content.slice(0, 4000) +
              '\n\n[...output truncated, total length: ' +
              result.content.length +
              ' chars...]\n\n' +
              result.content.slice(-4000)
            : result.content;
        const reviewTask = [
          `## Quality Review Task`,
          '',
          `Review the following output produced by the "${roleType}" agent.`,
          `The original user message was: "${message.slice(0, 500)}"`,
          '',
          `Agent output to review:`,
          reviewContent,
          '',
          `Review for: logical completeness, evidence quality, risk assessment, factual errors.`,
          `Use available tools (search_memory, search_documents, read_file) to verify claims if possible.`,
          '',
          `After review, output ONLY a JSON object:`,
          `{"pass": true/false, "score": 0.0-1.0, "issues": [...], "suggestion": {...}}`,
        ].join('\n');
        reviewerLoop
          .run(reviewTask)
          .then((reviewResult: any) => {
            const reviewMatch = reviewResult.content.match(/\{[\s\S]*\}/);
            const review = reviewMatch
              ? JSON.parse(reviewMatch[0])
              : { pass: true, score: 1.0, issues: [] };
            persistReviewResult(ctx, roleType, sessionId, review);
            wrappedCallback.onQualityReview?.({
              pass: !!review.pass,
              score: typeof review.score === 'number' ? review.score : 1.0,
              issues: Array.isArray(review.issues) ? review.issues : [],
            });
            if (review.pass !== true && review.issues?.length > 0 && ctx.eventBus) {
              ctx.eventBus
                .publish({
                  messageId: `quality_alert_${Date.now()}`,
                  correlationId: sessionId,
                  causationId: null,
                  timestamp: new Date(),
                  messageType: MessageType.QualityAlert,
                  payload: {
                    type: 'review_quality',
                    message: `Quality review for ${roleType}: score ${review.score}, ${review.issues?.length ?? 0} issues`,
                    severity: review.score < 0.5 ? 'high' : review.score < 0.7 ? 'medium' : 'low',
                  },
                })
                .catch((err) => {
                  console.warn('Operation failed', err);
                });
              broadcast('quality_alert', {
                source: roleType,
                sessionId,
                score: review.score,
                issueCount: review.issues?.length ?? 0,
                topIssue: review.issues?.[0]?.detail?.slice(0, 200) ?? null,
              });
            }
          })
          .catch((err: any) => {
            console.warn('Operation failed', err);
          });
      }
    }
  } catch (e) {
    wrappedCallback.onError?.((e as Error).message ?? 'Unknown error');
    wrappedCallback.onDone('');
  }
}
