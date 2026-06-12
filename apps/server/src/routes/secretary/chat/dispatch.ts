import type { Context } from 'hono';
import { AgentDispatcher, type DispatchMode } from '@cabinet/agent';
import type { ServerContext } from '../../../context.js';
import { broadcast } from '../../../ws/handler.js';
import { createStandardToolExecutor } from '../../../agent-factory.js';
import { buildToolDependencies } from '../tool-dependencies.js';
import { resolveModel, getAgentLoopForRole } from '../agents.js';

export async function handlePipelineOrParallelDispatch(
  ctx: ServerContext,
  c: Context,
  params: {
    dispatchMode: DispatchMode;
    augmentedMessage: string;
    sessionId: string;
    projectId: string;
    captainId: string;
    model: string | null | undefined;
  },
): Promise<Response> {
  const { dispatchMode, augmentedMessage, sessionId, projectId, captainId, model } = params;

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
    ctx.gateway!,
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
        return results.map((r: any) => `[Memory] ${r.content}`);
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
