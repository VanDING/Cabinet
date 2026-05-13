import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.js';
import { AISDKAdapter, type LLMGateway } from '@cabinet/gateway';
import { AgentLoop, ToolExecutor, SafetyChecker, CheckpointManager } from '@cabinet/agent';
import { SecretaryAgent, IntentParser, SessionManager } from '@cabinet/secretary';
import { MemoryEventBus } from '@cabinet/events';
import { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import Database from 'better-sqlite3';

// Lazy initialization
let gateway: LLMGateway | null = null;
let agentLoop: AgentLoop | null = null;
let secretaryAgent: SecretaryAgent | null = null;
let db: Database.Database | null = null;
const sessionManager = new SessionManager();
const shortTerm = new ShortTermMemory();
const entity = new EntityMemory();

function getDb(): Database.Database {
  if (!db) {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function getGateway(): LLMGateway | null {
  if (gateway) return gateway;
  if (config.anthropicApiKey || config.openaiApiKey) {
    gateway = new AISDKAdapter({
      anthropic: config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : undefined,
      openai: config.openaiApiKey ? { apiKey: config.openaiApiKey } : undefined,
    });
    console.log('[secretary] LLM Gateway initialized');
    return gateway;
  }
  console.log('[secretary] No API keys configured — using fallback mode');
  return null;
}

function getSecretaryAgent(): SecretaryAgent {
  if (secretaryAgent) return secretaryAgent;

  const gw = getGateway();
  const executor = new ToolExecutor();
  const intentParser = new IntentParser(gw ?? undefined);
  const ckptDb = getDb();

  // Register basic tools that don't need external deps (DecisionStore, etc.)
  executor.register({
    name: 'get_status',
    execute: async () => ({
      status: 'operational',
      mode: gw ? 'llm' : 'fallback',
      timestamp: new Date().toISOString(),
    }),
  });
  executor.register({
    name: 'remember',
    execute: async (args: Record<string, unknown>) => {
      shortTerm.set(
        (args.sessionId as string) ?? 'default',
        (args.key as string),
        args.value,
        (args.ttlMs as number) ?? undefined
      );
      return { remembered: true };
    },
  });
  executor.register({
    name: 'recall',
    execute: async (args: Record<string, unknown>) => {
      const sid = (args.sessionId as string) ?? 'default';
      const key = args.key as string | undefined;
      if (key) {
        const val = shortTerm.get(sid, key);
        return val !== null ? { found: true, value: val } : { found: false };
      }
      return shortTerm.getAll(sid);
    },
  });

  // Real memory provider wired to actual stores
  const memoryProvider = {
    async getShortTerm(sessionId: string) {
      const all = shortTerm.getAll(sessionId);
      return Object.entries(all).map(([k, v]) => ({
        role: 'user' as const,
        content: `[${k}]: ${JSON.stringify(v)}`,
      }));
    },
    async getProjectContext(_projectId: string) {
      return 'Cabinet v2.0 project. You are a helpful AI assistant (Secretary).';
    },
    async getEntityPreferences(_captainId: string) {
      const prefs = entity.getPreferences('captain-1');
      return prefs?.preferences ?? {};
    },
    async searchLongTerm(_query: string, _projectId: string) {
      return [];
    },
  };

  const checkpointManager = new CheckpointManager(ckptDb);

  if (gw) {
    agentLoop = new AgentLoop({
      gateway: gw,
      toolExecutor: executor,
      safetyChecker: new SafetyChecker(),
      checkpointManager,
      memoryProvider,
      sessionId: 'default',
      projectId: 'default',
      captainId: 'captain-1',
      maxSteps: 5,
    });
  }

  secretaryAgent = new SecretaryAgent(
    agentLoop ?? (null as any),
    intentParser,
    sessionManager,
    gw ?? undefined
  );
  console.log('[secretary] Agent initialized (mode:', gw ? 'llm' : 'fallback', ')');
  return secretaryAgent;
}

export const secretaryRouter = new Hono();
const chatSchema = z.object({ sessionId: z.string(), message: z.string() });

secretaryRouter.post('/chat', async (c) => {
  const body = await c.req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error }, 400);

  const { sessionId, message } = parsed.data;

  if (!sessionManager.get(sessionId)) {
    sessionManager.create(sessionId, `Session ${sessionId.slice(0, 8)}`);
  }

  try {
    const agent = getSecretaryAgent();
    const gw = getGateway();

    if (gw && agentLoop) {
      // Real LLM path
      const result = await agent.handleMessage(sessionId, message);
      return c.json({
        sessionId,
        response: result.response,
        intent: result.intent,
        mode: 'llm',
        toolCalls: (result as any).toolCalls?.length ?? 0,
      });
    } else {
      // Fallback: keyword parser only (no API keys configured)
      const parser = new IntentParser();
      const intent = parser.parse(message);
      sessionManager.addMessage(sessionId, 'user', message);
      const response =
        `[No API key] Intent: ${intent.kind}. ` +
        `Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env for LLM mode.`;
      sessionManager.addMessage(sessionId, 'assistant', response);
      return c.json({ sessionId, response, intent, mode: 'fallback' });
    }
  } catch (error) {
    const msg = (error as Error).message;
    console.error('[secretary] Agent error:', msg);
    const isAuthError =
      msg.includes('API key') || msg.includes('not configured') || msg.includes('401');
    return c.json(
      {
        sessionId,
        response: `Error: ${msg}`,
        intent: { kind: 'unknown' },
        mode: 'error',
      },
      isAuthError ? 503 : 500
    );
  }
});

// LLM connectivity check endpoint
secretaryRouter.get('/verify', async (c) => {
  const gw = getGateway();
  if (!gw) {
    return c.json({
      status: 'no_api_key',
      message: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env to enable LLM.',
    });
  }

  try {
    const start = Date.now();
    const response = await gw.generateText({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
      maxTokens: 10,
    });
    const latency = Date.now() - start;
    return c.json({
      status: 'ok',
      latency_ms: latency,
      model: response.model,
      tokens: response.usage,
    });
  } catch (error) {
    return c.json(
      {
        status: 'error',
        message: (error as Error).message,
        hint: 'Check your API key and network connection.',
      },
      503
    );
  }
});

secretaryRouter.get('/sessions', (c) => {
  const sessions = sessionManager.list();
  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      messageCount: s.messages.length,
      updatedAt: s.updatedAt,
    })),
  });
});
