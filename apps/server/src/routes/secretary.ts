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

  if (!sessionManager.get(sessionId)) {
    sessionManager.create(sessionId, undefined, body.projectId);
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
  const { sessionManager, mastra } = getServerContext();
  const sessionId = c.req.query('sessionId');
  if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);

  const memory = (mastra as any)?.memory;
  const thread = memory ? await memory.getThreadById?.(sessionId) : null;
  const source = thread?.messages ?? sessionManager.get(sessionId)?.messages ?? [];

  const context = (source as Array<{ role: string; content: string }>)
    .slice(-10)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  return c.json({ context });
});

secretaryRouter.post('/compact', async (c) => {
  const { sessionManager } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const sessionId = body.sessionId ?? c.req.query('sessionId');
  if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);

  const session = sessionManager.get(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  sessionManager.compactMessages(sessionId, 'Manually compacted by user');
  return c.json({ status: 'compacted' });
});

secretaryRouter.get('/sessions/:id/children', (c) => {
  const { sessionManager } = getServerContext();
  const parentId = c.req.param('id');
  const children = sessionManager.getChildSessions(parentId);
  return c.json({ children });
});

secretaryRouter.post('/sessions/:id/close', (c) => {
  const { sessionManager } = getServerContext();
  const sessionId = c.req.param('id');
  const session = sessionManager.get(sessionId);
  if (!session) return c.json({ error: 'Session not found' }, 404);

  sessionManager.close(sessionId);
  return c.json({ status: 'closed' });
});

export { secretaryRouter };
