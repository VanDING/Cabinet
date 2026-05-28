import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import {
  DAILY_BUDGET,
  WEEKLY_BUDGET,
  MONTHLY_BUDGET,
  MessageType,
} from '@cabinet/types';

const EVENT_LABELS: Record<string, string> = {
  [MessageType.DecisionRequest]: 'Decision requested',
  [MessageType.DecisionResolved]: 'Decision resolved',
  [MessageType.TaskOrder]: 'Task ordered',
  [MessageType.TaskCompleted]: 'Task completed',
  [MessageType.TaskFailed]: 'Task failed',
  [MessageType.MeetingStarted]: 'Meeting started',
  [MessageType.MeetingCompleted]: 'Meeting completed',
  [MessageType.DeliberationProposal]: 'Deliberation proposal',
  [MessageType.WorkflowStarted]: 'Workflow started',
  [MessageType.WorkflowStatusChanged]: 'Workflow status changed',
  [MessageType.WorkflowCompleted]: 'Workflow completed',
  [MessageType.SecretaryMessage]: 'Secretary message',
  [MessageType.GreetingGenerated]: 'Greeting generated',
  [MessageType.BudgetAlert]: 'Budget alert',
  [MessageType.QualityAlert]: 'Quality alert',
  [MessageType.SystemNotification]: 'System notification',
  [MessageType.AuditEvent]: 'Audit event',
};

export const dashboardRouter = new Hono();

dashboardRouter.get('/summary', (c) => {
  const {
    decisionRepo,
    costTracker,
    budgetGuard,
    projectRepo,
    workflowRepo,
    eventRepo,
    auditLogRepo,
    metrics,
    logger,
    db,
  } = getServerContext();
  const projectId = c.req.query('projectId');

  let pendingDecisions = 0,
    activeProjects = 1,
    activeWorkflows = 0;
  const recentEvents: { message: string; type: string; time: Date }[] = [];

  try {
    pendingDecisions = (
      projectId ? decisionRepo.listPending(projectId) : decisionRepo.listAllPending()
    ).length;
  } catch (err) {
    logger.warn('Failed to load pending decisions', { error: (err as Error).message });
  }
  try {
    activeProjects = projectRepo.listAll().filter((p) => !p.archived).length;
  } catch (err) {
    logger.warn('Failed to load projects', { error: (err as Error).message });
  }
  try {
    activeWorkflows = workflowRepo.countByStatus(['running']);
  } catch (err) {
    logger.warn('Failed to load workflows', { error: (err as Error).message });
  }
  try {
    const events = eventRepo.findAll().slice(-10);
    for (const e of events) {
      recentEvents.push({
        message: EVENT_LABELS[e.messageType] ?? e.messageType,
        type: e.messageType,
        time: e.timestamp,
      });
    }
  } catch (err) {
    logger.warn('Failed to load events', { error: (err as Error).message });
  }

  // Fallback: if event_log is empty (broadcast doesn't write to it), synthesise
  // recent events from audit_log which is reliably populated.
  if (recentEvents.length === 0) {
    try {
      const audits = auditLogRepo.findAll({ limit: 20 });
      for (const row of audits.reverse()) {
        const label = `${row.entity_type} ${row.action}`;
        recentEvents.push({
          message: label.charAt(0).toUpperCase() + label.slice(1),
          type: row.entity_type,
          time: new Date(row.timestamp),
        });
      }
    } catch (err) {
      logger.warn('Failed to load audit fallback events', { error: (err as Error).message });
    }
  }

  return c.json({
    pendingDecisions,
    todayCost: costTracker.getDailyCost(),
    activeProjects,
    activeWorkflows,
    recentEvents,
    budgetStatus: budgetGuard.checkAll(),
    summary: metrics.getSummary(),
  });
});

dashboardRouter.get('/cost-history', (c) => {
  const { costTracker, metricRepo, sessionMetricsRepo } = getServerContext();
  const days = parseInt(c.req.query('days') ?? '7', 10);
  const history: {
    date: string;
    cost: number;
    calls: number;
    tokens: number;
    byModel: Record<string, number>;
  }[] = [];
  let totalCalls = 0;

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    // Per-model cost breakdown
    const byModel: Record<string, number> = {};
    try {
      const rows = metricRepo.aggregateCostByDate(`%${dateStr}%`);

      for (const row of rows) {
        // Extract model from tags JSON: {"model":"claude-sonnet-4-6",...}
        try {
          const tags = JSON.parse(row.tags ?? '{}');
          const model = tags.model ?? 'unknown';
          byModel[model] = (byModel[model] ?? 0) + parseFloat(String(row.cost ?? 0));
        } catch {
          byModel['unknown'] = (byModel['unknown'] ?? 0) + parseFloat(String(row.cost ?? 0));
        }
      }

      totalCalls += metricRepo.aggregateCallsByDate(`%${dateStr}%`);
    } catch {
      /* metrics aggregation error for this date */
    }

    const totalCost = Object.values(byModel).reduce((sum, c) => sum + c, 0);

    // Tokens for this day from session_metrics
    let tokens = 0;
    try {
      tokens = sessionMetricsRepo.sumTokensByDate(`${dateStr}%`);
    } catch {
      /* ignore */
    }

    history.push({
      date: dateStr,
      cost: Math.round(totalCost * 10000) / 10000,
      calls: totalCalls,
      tokens,
      byModel,
    });
  }

  // Budget status for trend comparison
  const budgetStatus = costTracker
    ? {
        daily: costTracker.getDailyCost(),
        weekly: costTracker.getWeeklyCost?.() ?? 0,
        monthly: costTracker.getMonthlyCost?.() ?? 0,
      }
    : { daily: 0, weekly: 0, monthly: 0 };

  return c.json({
    history,
    dailyCost: costTracker.getDailyCost(),
    budgetStatus,
    limits: { daily: DAILY_BUDGET, weekly: WEEKLY_BUDGET, monthly: MONTHLY_BUDGET },
  });
});
