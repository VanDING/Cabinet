import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { broadcast } from '../ws/handler.js';
import { ANALYSIS_PERSPECTIVES } from '../api-helpers.js';
import { ParallelReasoning, CrossValidator, estimateMeetingCost } from '@cabinet/meeting';

export const meetingsRouter = new Hono();

// GET /api/meetings — list all meetings
meetingsRouter.get('/', (c) => {
  const { db } = getServerContext();
  try {
    const rows = db
      .prepare(
        "SELECT * FROM audit_log WHERE entity_type = 'meeting' ORDER BY timestamp DESC LIMIT 50",
      )
      .all() as any[];
    const meetings = rows.map((r: any) => {
      const data = JSON.parse(r.changes ?? '{}');
      return {
        meetingId: r.entity_id,
        topic: data.topic ?? 'Untitled',
        status: data.status ?? 'completed',
        estimatedCost: data.estimatedCost ?? 0,
        summary: data.summary ?? '',
        attendees: data.attendees ?? [],
        perspectives: data.perspectives ?? [],
        crossValidation: data.crossValidation ?? null,
        timestamp: r.timestamp,
      };
    });
    return c.json({ meetings });
  } catch (e) {
    return c.json({ meetings: [], error: (e as Error).message });
  }
});

// POST /api/meetings — multi-agent deliberation using @cabinet/meeting package
meetingsRouter.post('/', async (c) => {
  const { gateway, costTracker, metrics, logger, db } = getServerContext();
  const body = await c.req.json();
  const topic = body.topic ?? 'Untitled Meeting';
  const meetingId = `meeting_${Date.now()}`;
  const selected = body.advisors ?? ANALYSIS_PERSPECTIVES.map((p) => p.id);

  const advisors = ANALYSIS_PERSPECTIVES
    .filter((p) => selected.includes(p.id))
    .map((p) => ({ id: p.id, name: p.name, role: p.framework, model: 'claude-haiku-4-5', perspective: p.framework }));

  if (!gateway) {
    const synthesis = `[No LLM] Meeting on "${topic}" created. Configure API keys for AI-powered multi-agent meetings.`;
    db.prepare(
      "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))",
    ).run(meetingId, JSON.stringify({ topic, status: 'started', synthesis }));
    return c.json({ meetingId, topic, status: 'started', estimatedCost: 0, synthesis });
  }

  // Pre-meeting cost estimate
  const costEstimate = estimateMeetingCost(advisors.length, 1);
  const model = 'claude-haiku-4-5';

  // Phase 1: Parallel reasoning
  const reasoning = new ParallelReasoning(gateway);
  const reasonings = await reasoning.reason(advisors, topic);

  for (const _ of reasonings) {
    costTracker.record(model, 50, 150);
    metrics.increment('llm_call', { model, purpose: 'meeting_advisor' });
  }

  const perspectives = reasonings.map((r) => ({
    name: (r as any).advisor?.name ?? (r as any).name ?? 'Unknown',
    framework: (r as any).advisor?.role ?? (r as any).framework ?? '',
    content: (r as any).content ?? '',
  }));

  // Phase 2: Cross-validation
  let crossValidation = null;
  try {
    const validator = new CrossValidator(gateway);
    crossValidation = await validator.validate(topic, reasonings);
    metrics.increment('llm_call', { model, purpose: 'meeting_cross_validate' });
  } catch {
    // Cross-validation failure is non-fatal
  }

  // Phase 3: Chair synthesis
  let synthesis = '';
  let disagreements: string[] = [];
  try {
    const summary = perspectives
      .map((p: any) => `[${p.name ?? p.advisor}]: ${p.content}`)
      .join('\n\n');

    let validationNote = '';
    if (crossValidation) {
      const v = crossValidation as any;
      validationNote = [
        v.disagreements?.length
          ? `\nKey disagreements:\n${v.disagreements.map((d: string) => `- ${d}`).join('\n')}`
          : '',
        v.gaps?.length
          ? `\nUnaddressed angles:\n${v.gaps.map((g: string) => `- ${g}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    const chairPrompt = [
      `You are the Chair. Review advisor perspectives on "${topic}" and provide:`,
      '1. A 2-3 sentence synthesis combining the best insights',
      '2. Key risks identified',
      '3. Recommended next step',
      validationNote ? `\nAdditional analysis:\n${validationNote}` : '',
      `\nAdvisor perspectives:\n${summary}`,
    ].join('\n');

    const chairResponse = await gateway.generateText({
      model,
      messages: [{ role: 'user', content: chairPrompt }],
      maxTokens: 400,
    });
    synthesis = chairResponse.content;
    costTracker.record(model, 200, 400);
    metrics.increment('llm_call', { model, purpose: 'meeting_chair' });

    const lines = synthesis.split('\n').filter((l) => l.includes('- ') || l.includes('• '));
    disagreements = lines.slice(0, 5);
  } catch (e) {
    logger.warn('Meeting synthesis failed', { error: String(e) });
    synthesis = 'Synthesis unavailable.';
  }

  const attendees = perspectives.map((p: any) => p.name ?? p.advisor);

  // Persist
  db.prepare(
    "INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp) VALUES ('meeting', ?, 'create', 'system', ?, datetime('now'))",
  ).run(
    meetingId,
    JSON.stringify({
      topic,
      status: 'completed',
      estimatedCost: costEstimate.estimatedCostUsd,
      synthesis,
      attendees,
      perspectives,
      crossValidation,
      disagreements,
    }),
  );

  broadcast('meeting_created', {
    meetingId,
    topic,
    estimatedCost: costEstimate.estimatedCostUsd,
    attendees,
  });

  return c.json({
    meetingId,
    topic,
    status: 'completed',
    estimatedCost: costEstimate.estimatedCostUsd,
    perspectives,
    synthesis,
    crossValidation,
    disagreements,
    attendees,
  });
});

// GET /api/meetings/:id/status
meetingsRouter.get('/:id/status', (c) => {
  const { db, costTracker } = getServerContext();
  const id = c.req.param('id');
  const row = db
    .prepare(
      "SELECT * FROM audit_log WHERE entity_type = 'meeting' AND entity_id = ? ORDER BY timestamp DESC LIMIT 1",
    )
    .get(id) as any;

  if (row) {
    const data = JSON.parse(row.changes ?? '{}');
    return c.json({
      meetingId: id,
      topic: data.topic,
      status: data.status,
      estimatedCost: data.estimatedCost,
      actualCost: costTracker.getDailyCost(),
      attendees: data.attendees ?? [],
      perspectives: data.perspectives ?? [],
      crossValidation: data.crossValidation ?? null,
      summary: data.summary,
      timestamp: row.timestamp,
    });
  }

  return c.json({ meetingId: id, status: 'not_found' }, 404);
});
