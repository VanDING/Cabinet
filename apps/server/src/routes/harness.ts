import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const harnessRouter = new Hono();

harnessRouter.get('/overview', (c) => {
  const { observability, autoAdjuster } = getServerContext();

  const health = observability.getHealth();
  const report = observability.generateReport(
    new Date(new Date().setDate(new Date().getDate() - 7)),
    new Date(),
  );

  // Today's stats from daily snapshots
  const todayStr = new Date().toISOString().slice(0, 10);
  const todaySnap = (report.daily ?? []).find((d) => d.date === todayStr);

  // 7-day trend
  const trend = (report.daily ?? []).map((d) => ({
    date: d.date,
    toolSuccessRate: d.toolSuccessRate,
    sessionSuccessRate: d.successRate,
  }));

  const actions = autoAdjuster.getRecentActions(10);
  const lastEscalation = actions[0] ?? null;

  return c.json({
    today: {
      toolPassRate: todaySnap?.toolSuccessRate ?? 0,
      sessionSuccessRate: todaySnap?.successRate ?? 0,
      sessions: todaySnap?.sessions ?? 0,
    },
    health: {
      toolHealth: health.toolHealth,
      contextHealth: health.contextHealth,
      successRate: health.successRate,
    },
    trend,
    recentActions: actions.map((a) => ({
      type: a.type,
      severity: a.severity,
      description: a.description,
      requiresApproval: a.requiresCaptainApproval,
      applied: a.applied,
      timestamp: a.timestamp,
    })),
    lastEscalation: lastEscalation
      ? {
          type: lastEscalation.type,
          severity: lastEscalation.severity,
          description: lastEscalation.description,
          timestamp: lastEscalation.timestamp,
        }
      : null,
  });
});
