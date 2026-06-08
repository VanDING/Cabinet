// POST /chat route handler — extracted from secretary.ts (Phase 1.1 split).

import { z } from 'zod';
import type { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { DEFAULT_CAPTAIN_ID } from '@cabinet/types';
import { AgentDispatcher, type DispatchMode, type AgentRoleType } from '@cabinet/agent';
import {
  GreetingService,
  IntentParser,
  type ParsedIntent,
  type AgentRouteResult,
} from '@cabinet/secretary';
import { broadcast } from '../../ws/handler.js';
import { createStandardToolExecutor } from '../../agent-factory.js';
import {
  dispatchToSpecialist,
  dispatchToSpecialistStreaming,
  getOrCreateAgent,
  detectTrustLevelOverride,
  sessionTrustLevel,
  resolveModel,
  getAgentLoopForRole,
} from './agents.js';
import { buildToolDependencies } from './tool-dependencies.js';
import { readTextFile, isTextFile } from './utils.js';

const fileSchema = z
  .object({
    name: z.string(),
    path: z.string(),
    type: z.string().optional(),
  })
  .passthrough();

const chatSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  captainId: z.string().optional(),
  projectId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  files: z.array(fileSchema).optional(),
  stream: z.boolean().optional(),
  dispatchMode: z.enum(['single', 'pipeline', 'parallel']).optional(),
  thinkingBudget: z.number().min(1024).max(128000).nullable().optional(),
  targetAgent: z.string().optional(),
  type: z.enum(['chat', 'skill_invoke']).optional().default('chat'),
  skillName: z.string().optional(),
  skillArgs: z.string().optional(),
  interactive: z.boolean().optional(),
});
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
      // Proactive greeting for new sessions — persist as first assistant message
      try {
        const greeter = new GreetingService();
        const pendingDecisions = ctx.db
          .prepare("SELECT COUNT(*) as count FROM decisions WHERE status = 'pending'")
          .get() as { count: number } | undefined;
        const activeWorkflows = ctx.db
          .prepare(
            "SELECT COUNT(*) as count FROM workflows WHERE status = 'active' OR status = 'running'",
          )
          .get() as { count: number } | undefined;
        const prefs = ctx.entity.getPreferences(captainId);
        const captainName = prefs?.name ?? 'Captain';
        const greeting = greeter.generate({
          captainName,
          pendingDecisions: pendingDecisions?.count ?? 0,
          activeWorkflows: activeWorkflows?.count ?? 0,
          todayCost: ctx.costTracker?.getDailyCost() ?? 0,
        });
        // Persist greeting as chat message so it appears in the dialog
        let greetingText = greeting.greeting;
        if (greeting.suggestions && greeting.suggestions.length > 0) {
          greetingText +=
            '\n\n**Suggestions:**\n' + greeting.suggestions.map((s: string) => `- ${s}`).join('\n');
        }
        // Inject Curator session brief if available
        try {
          const brief = ctx.shortTerm.get(sessionId, 'session_brief');
          if (brief && typeof brief === 'string' && brief.length > 0) {
            greetingText += `\n\n**Context Brief:**\n${brief}`;
          }
        } catch {
          /* brief lookup failure is non-fatal */
        }
        ctx.sessionManager.addMessage(sessionId, 'assistant', greetingText);
        broadcast('secretary_greeting', { sessionId, greeting });
      } catch {
        // Greeting failure is non-fatal
      }
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
      let augmentedMessage = message;
      if (files.length > 0) {
        const fileLines: string[] = [];
        for (const f of files) {
          fileLines.push(`- ${f.name} (${f.path})`);
          if (f.type === 'project') {
            try {
              const { readFile } = await import('node:fs/promises');
              const { join } = await import('node:path');
              const root = join(process.cwd(), '..', '..', '..');
              const fullPath = join(root, f.path);
              if (fullPath.startsWith(root)) {
                const content = await readTextFile(fullPath);
                fileLines.push(`\n--- ${f.path} ---\n${content.slice(0, 8000)}\n`);
              }
            } catch {
              /* file not readable, skip content */
            }
          }
        }
        augmentedMessage = `${message}\n\n[Attached files]\n${fileLines.join('\n')}`;
      }

      // Direct skill invocation: if message starts with /skillName, load and inject skill prompt
      let skillInvokeContext: { skillName: string; args: string } | null = null;
      if (parsed.data.type === 'skill_invoke' && parsed.data.skillName) {
        const skillName = parsed.data.skillName;
        const skillArgs = parsed.data.skillArgs ?? '';
        const skill = ctx.skillRegistry.load(skillName);
        if (skill) {
          const skillResult = await ctx.skillRegistry.executeSkill(skill, { arguments: skillArgs });
          agentLoop?.setSkillContext(skillResult.output);
          skillInvokeContext = { skillName, args: skillArgs };
        } else {
          return c.json({
            sessionId,
            projectId,
            captainId,
            response: `Skill not found: /${skillName}. Available skills: ${ctx.skillRegistry.listNames().join(', ')}`,
            intent: { kind: 'unknown', raw: message },
            mode: 'single',
            dispatchMode: 'single',
            model: model ?? 'claude-sonnet-4-6',
            agentName: 'Secretary',
          });
        }
      } else {
        const skillMatch = augmentedMessage.trim().match(/^\/(\S+)/);
        if (skillMatch) {
          const skillName = skillMatch[1];
          const skillArgs = augmentedMessage.slice(skillMatch[0].length).trim();
          if (skillName) {
            const skill = ctx.skillRegistry.load(skillName);
            if (skill) {
              const skillResult = await ctx.skillRegistry.executeSkill(skill, {
                arguments: skillArgs,
              });
              agentLoop?.setSkillContext(skillResult.output);
              skillInvokeContext = { skillName, args: skillArgs };
            } else {
              return c.json({
                sessionId,
                projectId,
                captainId,
                response: `Skill not found: /${skillName}. Available skills: ${ctx.skillRegistry.listNames().join(', ')}`,
                intent: { kind: 'unknown', raw: message },
                mode: 'single',
                dispatchMode: 'single',
                model: model ?? 'claude-sonnet-4-6',
                agentName: 'Secretary',
              });
            }
          }
        }
      }

      if (ctx.gateway) {
        // ── Dispatch mode: pipeline or parallel ──
        if (dispatchMode === 'pipeline' || dispatchMode === 'parallel') {
          const executor = createStandardToolExecutor(
            ctx,
            buildToolDependencies(ctx, projectId === 'global' ? undefined : projectId, {
              getAgentLoopForRole,
              resolveModel,
            }),
          );

          const rateLimitTracker = (
            ctx.gateway as {
              getRateLimitTracker?: () => import('@cabinet/gateway').RateLimitTracker;
            }
          )?.getRateLimitTracker?.();
          const dispatcher = new AgentDispatcher(
            ctx.gateway,
            executor,
            ctx.db,
            {
              async getShortTerm(sid: string) {
                const items: { role: 'user' | 'assistant'; content: string }[] = [];
                const session = ctx.sessionManager.get(sid);
                if (session && session.messages.length > 0) {
                  // Include all messages except the current one (which is added separately by AgentLoop)
                  const recentCount = Math.min(session.messages.length, 30);
                  const start = Math.max(0, session.messages.length - recentCount);
                  for (let i = start; i < session.messages.length; i++) {
                    const m = session.messages[i]!;
                    items.push({ role: m.role, content: m.content });
                  }
                }
                const kv = ctx.shortTerm.getAll(sid);
                for (const [k, v] of Object.entries(kv)) {
                  if (typeof v === 'string' && v.length > 0) {
                    items.push({ role: 'user' as const, content: `[${k}]: ${v}` });
                  }
                }
                return items;
              },
              async getProjectContext(_pid: string) {
                const projCtx = ctx.project.get(_pid);
                if (!projCtx) return `Cabinet v2.0 project. ${_pid}`;
                return `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}`;
              },
              async getEntityPreferences(_captainId: string) {
                const prefs = ctx.entity.getPreferences(_captainId);
                return prefs?.preferences ?? {};
              },
              async searchLongTerm(query: string, _pid: string) {
                const results = await ctx.longTerm.search(query, 5);
                return results.map((r) => `[Memory] ${r.content}`);
              },
            },
            ctx.eventBus,
            ctx.agentRegistry,
            rateLimitTracker,
          );

          const result = await dispatcher.dispatch({
            mode: dispatchMode,
            request: augmentedMessage,
            sessionId,
            projectId,
            captainId,
          });

          ctx.metrics.increment('llm_call', {
            model: model ?? 'claude-sonnet-4-6',
            purpose: dispatchMode,
          });
          broadcast('secretary_message', { sessionId, projectId, captainId, mode: dispatchMode });
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
            response: result.finalOutput,
            dispatchMode,
            steps: result.steps.map((s) => ({
              role: s.role,
              status: s.status,
              durationMs: s.durationMs,
              agentSteps: s.steps,
            })),
            totalSteps: result.totalSteps,
            totalDurationMs: result.totalDurationMs,
          });
        }

        // ── Single mode (default) ──
        // SSE streaming path — true token-level streaming via gateway.streamText()
        if (stream) {
          const targetAgent = parsed.data.targetAgent;
          if (targetAgent && targetAgent !== 'secretary') {
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
                      onChunk(content) {
                        streamedContent += content;
                        emit('chunk', { content });
                      },
                      onThinking(content) {
                        emit('thinking', { content });
                      },
                      onThinkingDone() {
                        emit('thinking_done', {});
                      },
                      onToolCall(name, args) {
                        emit('tool_status', {
                          message: `Using tool: ${name}...`,
                          toolType: 'call',
                          detail: { name, args },
                        });
                      },
                      onToolResult(name, result) {
                        emit('tool_status', {
                          message: `Tool completed: ${name}`,
                          toolType: 'result',
                          detail: { name, result },
                        });
                      },
                      onUsage(usage) {
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
                      onError(error) {
                        emit('error', { message: error });
                      },
                    },
                    thinkingBudget,
                    model ?? undefined,
                    parsed.data.interactive,
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

          const sseStream = new ReadableStream({
            async start(controller) {
              // Quality review tracking — keeps SSE open until review completes or times out
              let resolveQualityReview: (() => void) | null = null;
              const qualityReviewPromise = new Promise<void>((resolve) => {
                resolveQualityReview = resolve;
              });

              const encoder = new TextEncoder();
              function emit(type: string, data: Record<string, unknown>) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`),
                );
              }
              try {
                emit('status', { message: 'Thinking...' });

                let streamedContent = '';

                const streamingCb = {
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
                  onSubAgentToolCall(
                    agentName: string,
                    toolName: string,
                    args: Record<string, unknown>,
                  ) {
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

        // ── Direct agent dispatch (non-streaming) ──
        const targetAgent = parsed.data.targetAgent;
        if (targetAgent && targetAgent !== 'secretary') {
          ctx.sessionManager.addMessage(sessionId, 'user', message);
          const output = await dispatchToSpecialist(
            targetAgent as AgentRoleType,
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
          intent: ParsedIntent;
          routeResult?: AgentRouteResult;
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
            } as ParsedIntent,
            routeResult: {
              targetAgent: 'secretary',
              confidence: 1,
              reasoning: `Direct skill invocation: ${skillInvokeContext.skillName}`,
              intent: {
                kind: 'invoke_skill',
                skillName: skillInvokeContext.skillName,
                args: skillInvokeContext.args,
                raw: message,
              } as ParsedIntent,
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
