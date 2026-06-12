// POST /chat route handler — extracted from secretary.ts (Phase 1.1 split).

import type { Hono } from 'hono';
import { getServerContext } from '../../../context.js';
import { DEFAULT_CAPTAIN_ID } from '@cabinet/types';
import type { DispatchMode } from '@cabinet/agent';
import { IntentParser } from '@cabinet/secretary';
import { broadcast } from '../../../ws/handler.js';
import {
  dispatchToSpecialist,
  getOrCreateAgent,
  detectTrustLevelOverride,
  sessionTrustLevel,
} from '../agents.js';
import { chatSchema } from './schemas.js';
import { sendGreetingForNewSession } from './greeting.js';
import { augmentMessageWithFiles } from './files.js';
import { resolveSkillInvocation } from './skills.js';
import { handlePipelineOrParallelDispatch } from './dispatch.js';
import { handleTargetAgentStreaming, handleSecretaryStreaming } from './streaming.js';

export function registerChatRoute(router: Hono): void {
  router.post('/chat', async (c) => {
    const ctx = getServerContext();
    const body = await c.req.json();
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error }, 400);

    const { sessionId, message } = parsed.data;
    const captainId = parsed.data.captainId ?? DEFAULT_CAPTAIN_ID;
    const files = parsed.data.files ?? [];
    let projectId: string = parsed.data.projectId || '';
    const model = parsed.data.model;
    const stream = parsed.data.stream ?? false;
    const dispatchMode: DispatchMode = parsed.data.dispatchMode ?? 'single';
    const thinkingBudget = parsed.data.thinkingBudget ?? undefined;

    // Detect trust level override from natural language
    const trustOverride = detectTrustLevelOverride(message);
    if (trustOverride) {
      sessionTrustLevel.set(sessionId, trustOverride);
      ctx.logger.info('Trust level overridden via chat', { sessionId, trustLevel: trustOverride });
    }

    // Use 'global' as sentinel when no project is selected (no auto-creation)
    if (!projectId) {
      projectId = 'global';
    }

    const isNewSession = !ctx.sessionManager.get(sessionId);
    if (isNewSession) {
      ctx.sessionManager.create(
        sessionId,
        `Session ${sessionId.slice(0, 8)}`,
        projectId === 'global' ? undefined : projectId,
      );
      await sendGreetingForNewSession(ctx, sessionId, captainId, projectId);
    }

    try {
      const { agent, agentLoop } = getOrCreateAgent(
        sessionId,
        projectId || 'global',
        captainId,
        model ?? undefined,
        thinkingBudget,
      );

      // Augment message with attached file contents (shared by all modes)
      const augmentedMessage = await augmentMessageWithFiles(message, files);

      // Resolve skill invocation (direct or /skillName syntax)
      const skillResolution = await resolveSkillInvocation(
        ctx,
        parsed,
        agentLoop,
        message,
        augmentedMessage,
      );
      if (skillResolution.notFoundSkillName) {
        return c.json({
          sessionId,
          projectId,
          captainId,
          response: `Skill not found: /${skillResolution.notFoundSkillName}. Available skills: ${ctx.skillRegistry.listNames().join(', ')}`,
          intent: { kind: 'unknown', raw: message },
          mode: 'single',
          dispatchMode: 'single',
          model: model ?? 'claude-sonnet-4-6',
          agentName: 'Secretary',
        });
      }
      const skillInvokeContext = skillResolution.context;

      if (ctx.gateway) {
        // ── Dispatch mode: pipeline or parallel ──
        if (dispatchMode === 'pipeline' || dispatchMode === 'parallel') {
          return handlePipelineOrParallelDispatch(ctx, c, {
            dispatchMode,
            augmentedMessage,
            sessionId,
            projectId,
            captainId,
            model,
          });
        }

        // ── Single mode (default) ──
        // SSE streaming path — true token-level streaming via gateway.streamText()
        if (stream) {
          const targetAgent = parsed.data.targetAgent;
          if (targetAgent && targetAgent !== 'secretary') {
            return handleTargetAgentStreaming(ctx, {
              targetAgent,
              message,
              augmentedMessage,
              sessionId,
              projectId,
              captainId,
              model,
              thinkingBudget,
              interactive: parsed.data.interactive,
            });
          }

          return handleSecretaryStreaming(ctx, {
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
          });
        }

        // ── Direct agent dispatch (non-streaming) ──
        const targetAgent = parsed.data.targetAgent;
        if (targetAgent && targetAgent !== 'secretary') {
          ctx.sessionManager.addMessage(sessionId, 'user', message);
          const output = await dispatchToSpecialist(
            targetAgent as import('@cabinet/agent').AgentRoleType,
            augmentedMessage,
            sessionId,
            projectId,
            captainId,
            thinkingBudget,
            model ?? undefined,
          );
          ctx.sessionManager.addMessage(sessionId, 'assistant', output);
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
          return c.json({
            sessionId,
            projectId,
            captainId,
            response: output,
            mode: 'single',
            dispatchMode: 'single',
            model: model ?? 'claude-sonnet-4-6',
            agentName: targetAgent,
          });
        }

        // ── Non-streaming single mode ──
        let result: {
          response: string;
          intent: import('@cabinet/secretary').ParsedIntent;
          routeResult?: import('@cabinet/secretary').AgentRouteResult;
          usage?: { promptTokens: number; completionTokens: number };
        };
        if (skillInvokeContext && agentLoop) {
          ctx.sessionManager.addMessage(sessionId, 'user', message);
          const loopResult = await agentLoop.run(skillInvokeContext.args);
          ctx.sessionManager.addMessage(sessionId, 'assistant', loopResult.content);
          result = {
            response: loopResult.content,
            intent: {
              kind: 'invoke_skill',
              skillName: skillInvokeContext.skillName,
              args: skillInvokeContext.args,
              raw: message,
            } as import('@cabinet/secretary').ParsedIntent,
            routeResult: {
              targetAgent: 'secretary',
              confidence: 1,
              reasoning: `Direct skill invocation: ${skillInvokeContext.skillName}`,
              intent: {
                kind: 'invoke_skill',
                skillName: skillInvokeContext.skillName,
                args: skillInvokeContext.args,
                raw: message,
              } as import('@cabinet/secretary').ParsedIntent,
            },
            usage: loopResult.usage,
          };
        } else {
          result = await agent.handleMessage(sessionId, augmentedMessage);
        }

        // Record cost if available
        if (result.usage) {
          ctx.costTracker.record(
            model ?? 'claude-sonnet-4-6',
            result.usage.promptTokens,
            result.usage.completionTokens,
          );
        }
        ctx.metrics.increment('llm_call', { model: model ?? 'claude-sonnet-4-6', purpose: 'chat' });

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
        return c.json({
          sessionId,
          projectId,
          captainId,
          response: result.response,
          intent: result.intent,
          route: result.routeResult
            ? {
                targetAgent: result.routeResult.targetAgent,
                confidence: result.routeResult.confidence,
                reasoning: result.routeResult.reasoning,
                suggestion: result.routeResult.suggestion,
              }
            : undefined,
          mode: 'single',
          dispatchMode: 'single',
          model: model ?? 'claude-sonnet-4-6',
          toolCalls: (result as { toolCalls?: number }).toolCalls ?? 0,
          agentName: 'Secretary',
        });
      } else {
        const intent = (ctx.intentParser ?? new IntentParser()).parse(message);
        ctx.sessionManager.addMessage(sessionId, 'user', message);
        const response = `[No API key] Intent: ${intent.kind}. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env for LLM mode.`;
        ctx.sessionManager.addMessage(sessionId, 'assistant', response);
        broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'fallback' });
        return c.json({
          sessionId,
          projectId,
          captainId,
          response,
          intent,
          mode: 'fallback',
          model: 'none',
        });
      }
    } catch (error) {
      const msg = (error as Error).message;
      ctx.logger.error('Secretary agent error', { error: msg });
      const isAuthError =
        msg.includes('API key') || msg.includes('not configured') || msg.includes('401');
      return c.json(
        {
          sessionId,
          projectId,
          captainId,
          response: `Error: ${msg}`,
          intent: { kind: 'unknown' },
          mode: 'error',
        },
        isAuthError ? 503 : 500,
      );
    }
  });
}
