import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

export const meetingsRouter = new Hono();

meetingsRouter.post('/', async (c) => {
  const { gateway, costTracker, metrics, logger } = getServerContext();
  const body = await c.req.json();
  const topic = body.topic ?? 'Untitled Meeting';
  const meetingId = `meeting_${Date.now()}`;

  let estimatedCost = 0.35;
  let summary = '';

  if (gateway) {
    try {
      const response = await gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{
          role: 'user',
          content: `You are chairing a brief meeting on: "${topic}". Provide a 2-3 sentence summary of the likely discussion points and a rough cost estimate.`,
        }],
        maxTokens: 200,
      });
      summary = response.content;
      const promptTk = response.usage?.promptTokens ?? 0;
      const completionTk = response.usage?.completionTokens ?? 0;
      estimatedCost = ((promptTk + completionTk) / 1_000_000) * 1.0 || 0.35;
      costTracker.record('claude-haiku-4-5', promptTk, completionTk);
      metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'meeting' });
    } catch (e) {
      logger.warn('Meeting LLM call failed', { error: String(e) });
      summary = `Meeting on "${topic}" queued. Multi-agent deliberation will follow.`;
    }
  } else {
    summary = `[No LLM] Meeting on "${topic}" created. Configure API keys for AI-powered meetings.`;
  }

  broadcast('meeting_created', { meetingId, topic, estimatedCost });
  return c.json({ meetingId, topic, status: 'started', estimatedCost, summary });
});

meetingsRouter.get('/:id/status', (c) => {
  const { costTracker } = getServerContext();
  return c.json({
    meetingId: c.req.param('id'),
    status: 'completed',
    actualCost: costTracker.getDailyCost(),
    attendees: ['Financial Advisor', 'Market Analyst'],
    summary: 'Meeting completed. Multi-agent deliberation details available in the event log.',
  });
});
