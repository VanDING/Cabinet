import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { createSSEStream } from '../mastra/sse-encoder.js';
import { createCostTracker } from '../mastra/cost-tracker.js';
import { checkBudget } from '../mastra/budget-guard.js';

const secretaryRouter = new Hono();

secretaryRouter.post('/chat', async (c) => {
  const { sessionManager, mastra } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const { sessionId, message, files, model } = body as {
    sessionId?: string;
    message?: string;
    files?: { name: string; path: string; type: string }[];
    model?: string;
    stream?: boolean;
    projectId?: string;
  };

  if (!sessionId || !message) {
    return c.json({ error: 'sessionId and message are required' }, 400);
  }

  if (!mastra) {
    return c.json({ error: 'Mastra not initialized' }, 503);
  }

  const budget = checkBudget();
  if (!budget.allowed) {
    return c.json({ error: budget.reason }, 429);
  }

  const agent = mastra.getAgent('secretary');
  if (!agent) {
    return c.json({ error: 'Secretary agent not found' }, 503);
  }

  const existing = await sessionManager.get(sessionId);
  if (!existing) {
    await sessionManager.create(sessionId, undefined, body.projectId);
  }

  const fileContext = files?.length
    ? files.map((f) => `[File: ${f.name} (${f.type}) at ${f.path}]`).join('\n')
    : '';

  const input = fileContext ? `${message}\n\nAttached files:\n${fileContext}` : message;

  const costTracker = createCostTracker();

  const abortController = new AbortController();
  c.req.raw.signal.addEventListener('abort', () => abortController.abort());
  const timeoutId = setTimeout(() => abortController.abort(), 300_000);

  try {
    const result = await agent.stream(input, {
      ...(model ? { model } : {}),
      memory: { thread: { id: sessionId } },
      abortSignal: abortController.signal,
      maxSteps: 50,
      onStepFinish: costTracker.onStepFinish,
    });

    clearTimeout(timeoutId);

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = createSSEStream(result.fullStream.getReader(), {
      abortSignal: abortController.signal,
    });
    return c.newResponse(stream);
  } catch (err) {
    clearTimeout(timeoutId);
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const errorStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`),
        );
        controller.close();
      },
    });

    return c.newResponse(errorStream);
  }
});

secretaryRouter.post('/subagent/input', async (c) => {
  const { mastra } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId ?? body.subAgentSessionId;
  const message = body.message ?? body.input;
  const targetAgent = body.targetAgent;

  if (!sessionId || !message) {
    return c.json({ error: 'sessionId and message are required' }, 400);
  }

  if (!mastra) {
    return c.json({ error: 'Mastra not initialized' }, 503);
  }

  const agent = mastra.getAgent(targetAgent ?? 'secretary');
  if (!agent) {
    return c.json({ error: `Agent '${targetAgent}' not found` }, 404);
  }

  try {
    const result = await agent.generate(message, {
      memory: { thread: { id: `${sessionId}_sub` } },
    });
    const text = (result as { text?: string }).text ?? '';
    return c.json({ response: text });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

secretaryRouter.get('/context', async (c) => {
  const { mastra } = getServerContext();
  const sessionId = c.req.query('sessionId');
  if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);

  const memory = (mastra as any)?.memory;
  const thread = memory ? await memory.getThreadById?.(sessionId) : null;
  const messages = (thread?.messages ?? []) as Array<{ role: string; content: string }>;

  const messageCount = messages.length;
  const estimatedTokens = messages.reduce((sum: number, m) => {
    const text = `${m.role}: ${m.content}`;
    return sum + Math.ceil(text.length / 4);
  }, 0);
  const maxContextTokens = 200000;

  return c.json({ messageCount, estimatedTokens, maxContextTokens });
});

secretaryRouter.post('/compact', async (c) => {
  const { mastra } = getServerContext();
  const { sessionId } = (await c.req.json()) as { sessionId?: string };
  if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);

  const memory = (mastra as any)?.memory;
  if (!memory) return c.json({ compacted: false, error: 'Memory not available' }, 503);

  try {
    const thread = await memory.getThreadById?.(sessionId);
    if (!thread) return c.json({ compacted: false, error: 'Thread not found' }, 404);

    const allMessages = (thread.messages ?? []) as Array<{ role: string; content: string }>;
    if (allMessages.length <= 4) {
      return c.json({ compacted: false, messageCount: allMessages.length });
    }

    const compacted = [...allMessages.slice(-3)];
    await memory.updateThread?.(sessionId, { messages: compacted });

    return c.json({
      compacted: true,
      originalCount: allMessages.length,
      remainingCount: compacted.length,
    });
  } catch {
    return c.json({ compacted: false, error: 'Compaction failed' }, 500);
  }
});

secretaryRouter.get('/sessions/:id/children', (c) => {
  const { sessionManager } = getServerContext();
  const parentId = c.req.param('id');
  const children = sessionManager.getChildSessions(parentId);
  return c.json({ children });
});

secretaryRouter.post('/sessions/:id/close', async (c) => {
  const { sessionManager } = getServerContext();
  const sessionId = c.req.param('id');
  const session = await sessionManager.get(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  await sessionManager.close(sessionId);
  return c.json({ status: 'closed' });
});

secretaryRouter.post('/fork', async (c) => {
  const { sessionManager } = getServerContext();
  const { sourceSessionId, newSessionId } = (await c.req.json()) as {
    sourceSessionId: string;
    newSessionId: string;
  };
  if (!sourceSessionId || !newSessionId) {
    return c.json({ error: 'sourceSessionId and newSessionId are required' }, 400);
  }
  await sessionManager.fork(sourceSessionId, newSessionId);
  return c.json({ sessionId: newSessionId });
});

secretaryRouter.get('/greeting', async (c) => {
  const { sessionManager, costHistoryRepo, decisionRepo } = getServerContext();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const hour = now.getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const pendingDecisions = decisionRepo.listAllPending({ limit: 5 }).length;
  const todayCost = costHistoryRepo.sumSince(todayStart);

  const sessions = await sessionManager.list();

  return c.json({
    greeting: `${timeGreeting}, Captain`,
    pendingDecisions,
    todayCost: Math.round(todayCost * 100) / 100,
    activeSessions: sessions.length,
    suggestions: [
      pendingDecisions > 0
        ? `You have ${pendingDecisions} pending decision${pendingDecisions > 1 ? 's' : ''}`
        : null,
      todayCost > 0 ? `Today's cost: $${todayCost.toFixed(2)}` : null,
      'What would you like to work on?',
    ].filter(Boolean),
  });
});

export { secretaryRouter };
