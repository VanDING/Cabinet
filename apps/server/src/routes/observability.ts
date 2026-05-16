import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const observabilityRouter = new Hono();

// GET /api/observability/health — quick health status
observabilityRouter.get('/health', (c) => {
  const { observability } = getServerContext();
  return c.json(observability.getHealth());
});

// GET /api/observability/report — full observability report
observabilityRouter.get('/report', (c) => {
  const { observability } = getServerContext();
  const days = parseInt(c.req.query('days') ?? '7', 10);
  const from = new Date();
  from.setDate(from.getDate() - days);
  const to = new Date();

  const report = observability.generateReport(from, to);
  const health = observability.getHealth();
  const topTools = observability.getToolHealth().slice(0, 5);

  return c.json({ report, health, topTools });
});

// GET /api/observability/tools — per-tool health metrics
observabilityRouter.get('/tools', (c) => {
  const { observability } = getServerContext();
  return c.json({ tools: observability.getToolHealth() });
});

// GET /api/observability/export — raw export for external analysis
observabilityRouter.get('/export', (c) => {
  const { observability } = getServerContext();
  return c.json(observability.export());
});
