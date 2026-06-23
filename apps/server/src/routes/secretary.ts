import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { resolveModel } from '../mastra/model-config.js';

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

  const agent = mastra.getAgent('secretary');
  if (!agent) {
    return c.json({ error: 'Secretary agent not found' }, 503);
  }

  if (!sessionManager.get(sessionId)) {
    sessionManager.create(sessionId, undefined, body.projectId);
  }
  sessionManager.addMessage(sessionId, 'user', message);

  const fileContext = files?.length
    ? files.map((f) => `[File: ${f.name} (${f.type}) at ${f.path}]`).join('\n')
    : '';

  const input = fileContext ? `${message}\n\nAttached files:\n${fileContext}` : message;

  try {
    const result = await agent.stream(input, {
      model: resolveModel('default'),
      memory: { thread: { id: sessionId } },
    });
    const textStream = result.textStream.getReader();
    const encoder = new TextEncoder();
    let fullText = '';

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await textStream.read();
            if (done) break;
            fullText += value;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: value })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        } catch (err) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`),
          );
          controller.close();
        }
      },
    });

    sessionManager.addMessage(sessionId, 'assistant', fullText);

    return c.newResponse(responseStream);
  } catch (err) {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`),
        );
        controller.close();
      },
    });

    return c.newResponse(stream);
  }
});

secretaryRouter.post('/subagent/input', async (c) => {
  const { mastra } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const { sessionId, message, targetAgent } = body as {
    sessionId?: string;
    message?: string;
    targetAgent?: string;
  };

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

secretaryRouter.get('/context', (c) => {
  const { sessionManager } = getServerContext();
  const sessionId = c.req.query('sessionId');
  if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);

  const session = sessionManager.get(sessionId);
  if (!session) return c.json({ context: '' });

  const context = session.messages
    .slice(-10)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join('\n');

  return c.json({ context });
});

secretaryRouter.post('/compact', (c) => {
  const { sessionManager } = getServerContext();
  const sessionId = c.req.query('sessionId');
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
