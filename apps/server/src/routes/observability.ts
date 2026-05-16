import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { ObservabilityCollector } from '@cabinet/harness';

// Singleton collector per server process
let collector: ObservabilityCollector | null = null;

function getCollector(): ObservabilityCollector {
  if (!collector) {
    const { eventBus } = getServerContext();
    collector = new ObservabilityCollector(eventBus);
  }
  return collector;
}

export const observabilityRouter = new Hono();

// GET /api/observability/health — quick health status
observabilityRouter.get('/health', (c) => {
  const col = getCollector();
  const health = col.getHealth();
  return c.json(health);
});

// GET /api/observability/report — full observability report
observabilityRouter.get('/report', (c) => {
  const col = getCollector();
  const days = parseInt(c.req.query('days') ?? '7', 10);
  const from = new Date();
  from.setDate(from.getDate() - days);
  const to = new Date();

  const report = col.generateReport(from, to);
  const health = col.getHealth();
  const topTools = col.getToolHealth().slice(0, 5);

  return c.json({
    report,
    health,
    topTools,
  });
});

// GET /api/observability/tools — per-tool health metrics
observabilityRouter.get('/tools', (c) => {
  const col = getCollector();
  const tools = col.getToolHealth();
  return c.json({ tools });
});

// GET /api/observability/export — raw export for external analysis
observabilityRouter.get('/export', (c) => {
  const col = getCollector();
  const data = col.export();
  return c.json(data);
});
