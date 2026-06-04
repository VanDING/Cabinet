//
// Telemetry API — runtime metrics reported by external agents.
//
// POST /api/telemetry/report — Agent submits runtime metrics after task completion.
//

import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';

export const telemetryRouter = new Hono();

const telemetrySchema = z.object({
  task_id: z.string(),
  agent_id: z.string(),
  model: z.string(),
  tokens: z.object({
    prompt: z.number().int().min(0),
    completion: z.number().int().min(0),
  }),
  timing: z.object({
    ttft_ms: z.number().min(0),
    total_ms: z.number().min(0),
    tool_latency_ms: z.array(z.number().min(0)),
  }),
  steps: z.number().int().min(0),
  status: z.enum(['completed', 'failed']),
});

telemetryRouter.post('/report', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = telemetrySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid telemetry payload', details: parsed.error.flatten() }, 400);
    }

    const { costTracker, logger } = getServerContext();
    const d = parsed.data;

    // Feed token consumption into CostTracker for budget enforcement
    const totalTokens = d.tokens.prompt + d.tokens.completion;
    if ((costTracker as any).recordExternal) {
      (costTracker as any).recordExternal({
        model: d.model,
        promptTokens: d.tokens.prompt,
        completionTokens: d.tokens.completion,
      });
    }

    // Persist to database (if TelemetryRepository is registered)
    try {
      const { db } = getServerContext();
      db.prepare(
        `INSERT INTO agent_telemetry (task_id, agent_id, model, prompt_tokens, completion_tokens,
         ttft_ms, total_ms, tool_latency_json, steps, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).run(
        d.task_id, d.agent_id, d.model,
        d.tokens.prompt, d.tokens.completion,
        d.timing.ttft_ms, d.timing.total_ms,
        JSON.stringify(d.timing.tool_latency_ms),
        d.steps, d.status,
      );
    } catch {
      // Telemetry table may not exist yet — non-fatal
    }

    logger.info('Telemetry received', {
      taskId: d.task_id,
      agentId: d.agent_id,
      model: d.model,
      totalTokens,
      totalMs: d.timing.total_ms,
    });

    return c.json({ ok: true });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Telemetry report failed', { error: String(err) });
    return c.json({ error: 'Internal error' }, 500);
  }
});

// ── GET /api/telemetry/stats ─────────────────────────────────────

telemetryRouter.get('/stats', (c) => {
  try {
    const { telemetryRepo } = getServerContext();
    const agentId = c.req.query('agent_id');
    const stats = telemetryRepo.getStats(agentId ?? undefined);
    return c.json({ stats });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Telemetry stats failed', { error: String(err) });
    return c.json({ stats: [], error: 'Internal error' }, 500);
  }
});

// ── GET /api/telemetry/trends ─────────────────────────────────────

telemetryRouter.get('/trends', (c) => {
  try {
    const { db } = getServerContext();
    const agentId = c.req.query('agent_id') ?? 'all';
    const range = c.req.query('range') ?? '24h';
    const granularity = c.req.query('granularity') ?? '1h';

    // Calculate time cutoff
    const now = Date.now();
    const rangeMs: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    const cutoff = new Date(now - (rangeMs[range] ?? 86400000)).toISOString();
    const stepMs = granularity === '1d' ? 86400000 : 3600000;

    // Query buckets
    const agentFilter = agentId !== 'all' ? 'AND agent_id = ?' : '';
    const params: (string | number)[] = agentId !== 'all' ? [cutoff, agentId] : [cutoff];
    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:00:00', created_at) as ts,
        COUNT(*) as task_count,
        SUM(prompt_tokens) as prompt_tokens,
        SUM(completion_tokens) as completion_tokens,
        AVG(ttft_ms) as avg_ttft_ms,
        AVG(total_ms) as avg_total_ms
      FROM agent_telemetry
      WHERE created_at >= ? ${agentFilter}
      GROUP BY ts
      ORDER BY ts ASC
    `).all(...params) as Array<Record<string, unknown>>;

    // Summary stats
    const summaryRow = db.prepare(`
      SELECT
        COUNT(*) as total_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(prompt_tokens + completion_tokens) as total_tokens,
        COUNT(DISTINCT agent_id) as active_agents
      FROM agent_telemetry
      WHERE created_at >= ? ${agentFilter}
    `).get(...params) as Record<string, unknown> | undefined;

    // Agent latency
    const agentRows = db.prepare(`
      SELECT agent_id, AVG(total_ms) as avg_total_ms, AVG(ttft_ms) as avg_ttft_ms, COUNT(*) as total_tasks
      FROM agent_telemetry
      WHERE created_at >= ? ${agentFilter}
      GROUP BY agent_id ORDER BY avg_total_ms DESC
    `).all(...params) as Array<Record<string, unknown>>;

    const total = (summaryRow?.total_tasks as number) ?? 0;
    const completed = (summaryRow?.completed as number) ?? 0;
    return c.json({
      summary: {
        total_tasks: total,
        success_rate: total > 0 ? Math.round((completed / total) * 100) : 100,
        total_tokens: summaryRow?.total_tokens ?? 0,
        active_agents: summaryRow?.active_agents ?? 0,
      },
      buckets: rows.map((r) => ({
        ts: r.ts as string,
        task_count: r.task_count as number,
        tokens_prompt: r.prompt_tokens as number,
        tokens_completion: r.completion_tokens as number,
        avg_ttft_ms: Math.round(r.avg_ttft_ms as number),
        avg_total_ms: Math.round(r.avg_total_ms as number),
      })),
      agents: agentRows.map((r) => ({
        agent_id: r.agent_id as string,
        avg_total_ms: Math.round(r.avg_total_ms as number),
        avg_ttft_ms: Math.round(r.avg_ttft_ms as number),
        total_tasks: r.total_tasks as number,
      })),
    });
  } catch (err) {
    const { logger } = getServerContext();
    logger.error('Telemetry trends failed', { error: String(err) });
    return c.json({ summary: { total_tasks: 0, success_rate: 100, total_tokens: 0, active_agents: 0 }, buckets: [], agents: [] }, 500);
  }
});
