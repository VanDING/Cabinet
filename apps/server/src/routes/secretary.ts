import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { AgentLoop, ToolExecutor, SafetyChecker, CheckpointManager, registerCabinetTools } from '@cabinet/agent';
import { SecretaryAgent, IntentParser } from '@cabinet/secretary';
import { broadcast } from '../ws/handler.js';

export const secretaryRouter = new Hono();

// ── Lazy agent per request context ──
let agentLoopCache: AgentLoop | null = null;
let secretaryAgentCache: SecretaryAgent | null = null;
let lastGatewayCheck = false;

function getOrCreateAgent(sessionId: string, projectId: string, captainId: string, model?: string) {
  const ctx = getServerContext();
  const hasGateway = ctx.gateway !== null;

  // Reset cache if gateway status changed (e.g. API keys added/removed)
  if (hasGateway !== lastGatewayCheck) {
    agentLoopCache = null;
    secretaryAgentCache = null;
    lastGatewayCheck = hasGateway;
  }

  if (secretaryAgentCache && agentLoopCache) {
    return { agent: secretaryAgentCache, loop: agentLoopCache };
  }

  const executor = new ToolExecutor();

  // Register all 10 cabinet tools via ToolDependencies
  registerCabinetTools(executor, {
    decisionStore: ctx.decisionRepo,
    eventBus: ctx.eventBus,
    shortTerm: ctx.shortTerm,
    longTerm: ctx.longTerm,
    entity: ctx.entity,
    project: ctx.project,
  });

  const memoryProvider = {
    async getShortTerm(sid: string) {
      const all = ctx.shortTerm.getAll(sid);
      return Object.entries(all).map(([k, v]) => ({
        role: 'user' as const,
        content: `[${k}]: ${JSON.stringify(v)}`,
      }));
    },
    async getProjectContext(_pid: string) {
      const projCtx = ctx.project.get(_pid);
      if (!projCtx) return `Cabinet v2.0 project. ${_pid}`;
      return `Project: ${projCtx.summary}\nGoals: ${projCtx.goals.join(', ')}\nMilestones: ${projCtx.milestones.map(m => `${(m as any).name ?? (m as any).title ?? 'milestone'} (${(m as any).status ?? 'pending'})`).join(', ')}`;
    },
    async getEntityPreferences(_captainId: string) {
      const prefs = ctx.entity.getPreferences(_captainId);
      return prefs?.preferences ?? {};
    },
    async searchLongTerm(query: string, _pid: string) {
      const results = await ctx.longTerm.search(query, 5);
      return results.map(r => `[Memory] ${r.content}`);
    },
  };

  if (hasGateway) {
    const checkpointManager = new CheckpointManager(ctx.db);
    agentLoopCache = new AgentLoop({
      gateway: ctx.gateway!,
      toolExecutor: executor,
      safetyChecker: new SafetyChecker(),
      checkpointManager,
      memoryProvider,
      sessionId,
      projectId,
      captainId,
      maxSteps: 10,
    });
  }

  const intentParser = new IntentParser(hasGateway ? ctx.gateway! : undefined);
  secretaryAgentCache = new SecretaryAgent(
    agentLoopCache ?? (null as any),
    intentParser,
    ctx.sessionManager,
    ctx.gateway ?? undefined,
  );

  return { agent: secretaryAgentCache, loop: agentLoopCache };
}

// ── POST /chat ──
const chatSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  captainId: z.string().optional(),
  projectId: z.string().optional(),
  model: z.string().optional(),
});

secretaryRouter.post('/chat', async (c) => {
  const ctx = getServerContext();
  const body = await c.req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const { sessionId, message } = parsed.data;
  const captainId = parsed.data.captainId ?? 'captain-1';
  const projectId = parsed.data.projectId ?? 'default';
  const model = parsed.data.model;

  if (!ctx.sessionManager.get(sessionId)) {
    ctx.sessionManager.create(sessionId, `Session ${sessionId.slice(0, 8)}`);
  }

  try {
    const { agent, loop } = getOrCreateAgent(sessionId, projectId, captainId, model);

    if (loop && ctx.gateway) {
      // Replace agentLoop options with request-specific values
      const result = await agent.handleMessage(sessionId, message);

      // Record cost if available
      if ((result as any).usage) {
        ctx.costTracker.record(
          model ?? 'claude-sonnet-4-6',
          (result as any).usage.promptTokens ?? 0,
          (result as any).usage.completionTokens ?? 0,
        );
      }
      ctx.metrics.increment('llm_call', { model: model ?? 'claude-sonnet-4-6', purpose: 'chat' });

      broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'llm' });
      return c.json({
        sessionId, projectId, captainId,
        response: result.response,
        intent: result.intent,
        mode: 'llm',
        model: model ?? 'claude-sonnet-4-6',
        toolCalls: (result as any).toolCalls ?? 0,
      });
    } else {
      const parser = new IntentParser();
      const intent = parser.parse(message);
      ctx.sessionManager.addMessage(sessionId, 'user', message);
      const response = `[No API key] Intent: ${intent.kind}. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env for LLM mode.`;
      ctx.sessionManager.addMessage(sessionId, 'assistant', response);
      broadcast('secretary_message', { sessionId, projectId, captainId, mode: 'fallback' });
      return c.json({ sessionId, projectId, captainId, response, intent, mode: 'fallback', model: 'none' });
    }
  } catch (error) {
    const msg = (error as Error).message;
    console.error('[secretary] Agent error:', msg);
    const isAuthError = msg.includes('API key') || msg.includes('not configured') || msg.includes('401');
    return c.json({
      sessionId, projectId, captainId,
      response: `Error: ${msg}`, intent: { kind: 'unknown' }, mode: 'error',
    }, isAuthError ? 503 : 500);
  }
});

// ── GET /verify ──
secretaryRouter.get('/verify', async (c) => {
  const { gateway, costTracker, metrics } = getServerContext();
  if (!gateway) {
    return c.json({ status: 'no_api_key', message: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to enable LLM.' });
  }
  try {
    const start = Date.now();
    const response = await gateway.generateText({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    costTracker.record('claude-haiku-4-5', response.usage?.promptTokens ?? 0, response.usage?.completionTokens ?? 0);
    metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'verify' });
    const latency = Date.now() - start;
    return c.json({ status: 'ok', latency_ms: latency, model: response.model, tokens: response.usage });
  } catch (error) {
    return c.json({ status: 'error', message: (error as Error).message, hint: 'Check your API key and network connection.' }, 503);
  }
});

// ── GET /sessions ──
secretaryRouter.get('/sessions', (c) => {
  const { sessionManager } = getServerContext();
  const sessions = sessionManager.list();
  return c.json({
    sessions: sessions.map(s => ({
      id: s.id, title: s.title, messageCount: s.messages.length, updatedAt: s.updatedAt,
    })),
  });
});

// ── GET /context ──
secretaryRouter.get('/context', (c) => {
  const { sessionManager, metrics } = getServerContext();
  const sessionId = c.req.query('sessionId') ?? 'default';
  const session = sessionManager.get(sessionId);

  const messageCount = session?.messages.length ?? 0;
  // Rough estimate: ~4 chars per token
  const totalChars = session?.messages.reduce((sum, m) => sum + m.content.length, 0) ?? 0;
  const estimatedTokens = Math.ceil(totalChars / 4);

  return c.json({
    sessionId,
    messageCount,
    estimatedTokens,
    maxContextTokens: 200000,
    summary: metrics.getSummary(),
  });
});
