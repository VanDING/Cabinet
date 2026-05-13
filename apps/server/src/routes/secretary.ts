import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.js';
import { AISDKAdapter, type LLMGateway } from '@cabinet/gateway';
import { AgentLoop, ToolExecutor, SafetyChecker, CheckpointManager, createCabinetTools } from '@cabinet/agent';
import { SecretaryAgent, IntentParser, SessionManager } from '@cabinet/secretary';
import { MemoryEventBus } from '@cabinet/events';
import { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import type Database from 'better-sqlite3';

// Lazy initialization
let gateway: LLMGateway | null = null;
let agentLoop: AgentLoop | null = null;
let secretaryAgent: SecretaryAgent | null = null;
const sessionManager = new SessionManager();

function getGateway(): LLMGateway | null {
  if (gateway) return gateway;
  if (config.anthropicApiKey || config.openaiApiKey) {
    gateway = new AISDKAdapter({
      anthropic: config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : undefined,
      openai: config.openaiApiKey ? { apiKey: config.openaiApiKey } : undefined,
    });
    return gateway;
  }
  return null;
}

function getSecretaryAgent(db?: Database.Database): SecretaryAgent {
  if (secretaryAgent) return secretaryAgent;

  const gw = getGateway();
  const toolExecutor = new ToolExecutor();
  const intentParser = new IntentParser(gw ?? undefined);

  // Register tools if storage available
  if (db) {
    const eventBus = new MemoryEventBus();
    const shortTerm = new ShortTermMemory();
    const longTerm = new LongTermMemory(db);
    const entity = new EntityMemory();
    const project = new ProjectMemory();

    const deps = { eventBus, shortTerm, longTerm, entity, project, decisionStore: null as any };
    const tools = createCabinetTools(deps);
    for (const tool of tools) toolExecutor.register(tool);
  }

  const checkpointManager = db ? new CheckpointManager(db) : null as any;
  const memoryProvider = {
    async getShortTerm(sessionId: string) { return []; },
    async getProjectContext(projectId: string) { return ''; },
    async getEntityPreferences(captainId: string) { return {}; },
    async searchLongTerm(query: string, projectId: string) { return []; },
  };

  const loop = gw && checkpointManager ? new AgentLoop({
    gateway: gw,
    toolExecutor,
    safetyChecker: new SafetyChecker(),
    checkpointManager,
    memoryProvider,
    sessionId: 'default',
    projectId: 'default',
    captainId: 'default',
    maxSteps: 5,
  }) : null as any;

  secretaryAgent = new SecretaryAgent(loop, intentParser, sessionManager);
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

  const agent = getSecretaryAgent();
  const gw = getGateway();

  try {
    if (gw) {
      // Real LLM path
      const result = await agent.handleMessage(sessionId, message);
      return c.json({
        sessionId,
        response: result.response,
        intent: result.intent,
        mode: 'llm',
      });
    } else {
      // Fallback: keyword parser only
      const parser = new IntentParser();
      const intent = parser.parse(message);
      sessionManager.addMessage(sessionId, 'user', message);
      const response = `[No API key configured] I parsed your intent as: ${intent.kind}. ${intent.kind === 'decision_request' ? 'Suggested dimensions: ' + (intent as any).suggestedDimensions?.join(', ') : ''}`;
      sessionManager.addMessage(sessionId, 'assistant', response);
      return c.json({ sessionId, response, intent, mode: 'fallback' });
    }
  } catch (error) {
    return c.json({
      sessionId,
      response: `Agent error: ${(error as Error).message}`,
      intent: { kind: 'unknown' },
      mode: 'error',
    }, 500);
  }
});

secretaryRouter.get('/sessions', (c) => {
  const sessions = sessionManager.list();
  return c.json({ sessions: sessions.map(s => ({ id: s.id, title: s.title, messageCount: s.messages.length, updatedAt: s.updatedAt })) });
});
