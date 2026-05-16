import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';

export const meetingsRouter = new Hono();

// GET /api/meetings — list all meetings
meetingsRouter.get('/', (c) => {
  const { db } = getServerContext();
  try {
    const rows = db.prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'meeting' ORDER BY timestamp DESC LIMIT 50"
    ).all() as any[];
    const meetings = rows.map((r: any) => {
      const data = JSON.parse(r.changes ?? '{}');
      return {
        meetingId: r.entity_id,
        topic: data.topic ?? 'Untitled',
        status: data.status ?? 'completed',
        estimatedCost: data.estimatedCost ?? 0,
        summary: data.summary ?? '',
        attendees: data.attendees ?? [],
        timestamp: r.timestamp,
      };
    });
    return c.json({ meetings });
  } catch (e) {
    return c.json({ meetings: [], error: (e as Error).message });
  }
});

// Multi-agent advisors with distinct perspectives
const ADVISORS = [
  { id: 'financial', name: 'Financial Advisor', role: 'Finance', model: 'claude-haiku-4-5', perspective: 'Analyze financial implications, costs, ROI, and budget impact.' },
  { id: 'market', name: 'Market Analyst', role: 'Strategy', model: 'claude-haiku-4-5', perspective: 'Analyze market trends, competitive landscape, and strategic positioning.' },
  { id: 'legal', name: 'Legal Advisor', role: 'Compliance', model: 'claude-haiku-4-5', perspective: 'Identify legal risks, compliance requirements, and regulatory concerns.' },
  { id: 'captain', name: 'Captain', role: 'Decision', model: 'claude-haiku-4-5', perspective: 'Weigh all perspectives and recommend a final decision with actionable next steps.' },
];

// POST /api/meetings — multi-agent deliberation
meetingsRouter.post('/', async (c) => {
  const { gateway, costTracker, metrics, logger, db } = getServerContext();
  const body = await c.req.json();
  const topic = body.topic ?? 'Untitled Meeting';
  const meetingId = `meeting_${Date.now()}`;
  const selectedAdvisors = body.advisors ?? ADVISORS.map(a => a.id);

  const advisors = ADVISORS.filter(a => selectedAdvisors.includes(a.id));
  let totalEstimatedCost = 0;

  if (!gateway) {
    const summary = `[No LLM] Meeting on "${topic}" created. Configure API keys for AI-powered multi-agent meetings.`;
    db.prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))"
    ).run(meetingId, JSON.stringify({ topic, status: 'started', summary }));
    return c.json({ meetingId, topic, status: 'started', estimatedCost: 0, summary });
  }

  // Phase 1: Run all advisors in parallel
  const perspectives: { advisor: string; role: string; content: string; cost: number }[] = [];
  try {
    const results = await Promise.allSettled(
      advisors.map(async advisor => {
        const response = await gateway!.generateText({
          model: advisor.model,
          messages: [{
            role: 'user',
            content: `You are the ${advisor.name} (${advisor.role}). ${advisor.perspective}\n\nTopic for deliberation: "${topic}"\n\nProvide your 2-3 sentence analysis with concrete points. Be specific and data-driven.`,
          }],
          maxTokens: 200,
        });
        const promptTk = response.usage?.promptTokens ?? 0;
        const completionTk = response.usage?.completionTokens ?? 0;
        const cost = ((promptTk + completionTk) / 1_000_000) * 1.0;
        return { advisor: advisor.name, role: advisor.role, content: response.content, cost };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        perspectives.push(result.value);
        totalEstimatedCost += result.value.cost;
        costTracker.record('claude-haiku-4-5', 50, 150);
        metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'meeting_advisor' });
      } else {
        perspectives.push({ advisor: 'Unknown', role: 'Error', content: 'Failed to generate perspective.', cost: 0 });
      }
    }
  } catch (e) {
    logger.warn('Multi-agent meeting failed', { error: String(e) });
  }

  // Phase 2: Cross-validate — chair synthesizes
  let synthesis = '';
  let disagreements: string[] = [];
  try {
    const perspectiveSummary = perspectives.map(p => `[${p.advisor} (${p.role})]: ${p.content}`).join('\n\n');
    const chairResponse = await gateway.generateText({
      model: 'claude-haiku-4-5',
      messages: [{
        role: 'user',
        content: `You are the Chair. Review the following advisor perspectives on "${topic}" and provide:\n1. A 2-3 sentence synthesis combining the best insights\n2. Key disagreements or risks (as bullet points)\n3. Recommended next step\n\nAdvisor perspectives:\n${perspectiveSummary}`,
      }],
      maxTokens: 300,
    });
    synthesis = chairResponse.content;
    const promptTk = chairResponse.usage?.promptTokens ?? 0;
    const completionTk = chairResponse.usage?.completionTokens ?? 0;
    totalEstimatedCost += ((promptTk + completionTk) / 1_000_000) * 1.0;
    costTracker.record('claude-haiku-4-5', promptTk, completionTk);
    metrics.increment('llm_call', { model: 'claude-haiku-4-5', purpose: 'meeting_chair' });

    // Extract disagreements from synthesis
    const lines = synthesis.split('\n').filter(l => l.includes('- ') || l.includes('• '));
    disagreements = lines.slice(0, 5);
  } catch (e) {
    logger.warn('Meeting synthesis failed', { error: String(e) });
    synthesis = 'Synthesis unavailable.';
  }

  const attendees = perspectives.map(p => p.advisor);

  // Persist
  db.prepare(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))"
  ).run(meetingId, JSON.stringify({ topic, status: 'completed', estimatedCost: totalEstimatedCost, summary: synthesis, attendees, perspectives, disagreements }));

  broadcast('meeting_created', { meetingId, topic, estimatedCost: totalEstimatedCost, attendees });
  return c.json({
    meetingId, topic, status: 'completed',
    estimatedCost: totalEstimatedCost,
    perspectives,
    synthesis,
    disagreements,
    attendees,
  });
});

// GET /api/meetings/:id/status
meetingsRouter.get('/:id/status', (c) => {
  const { db, costTracker } = getServerContext();
  const id = c.req.param('id');
  const row = db.prepare(
    "SELECT * FROM audit_log WHERE entity_type = 'meeting' AND entity_id = ? ORDER BY timestamp DESC LIMIT 1"
  ).get(id) as any;

  if (row) {
    const data = JSON.parse(row.changes ?? '{}');
    return c.json({
      meetingId: id,
      topic: data.topic,
      status: data.status,
      estimatedCost: data.estimatedCost,
      actualCost: costTracker.getDailyCost(),
      attendees: data.attendees ?? [],
      summary: data.summary,
      timestamp: row.timestamp,
    });
  }

  return c.json({
    meetingId: id,
    status: 'completed',
    actualCost: costTracker.getDailyCost(),
    attendees: ['Financial Advisor', 'Market Analyst'],
    summary: 'Meeting completed.',
  });
});
