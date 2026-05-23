import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { DAILY_BUDGET_USD, WEEKLY_BUDGET_USD, MONTHLY_BUDGET_USD, MessageType } from '@cabinet/types';

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
  const { decisionRepo, costTracker, budgetGuard, projectRepo, eventRepo, metrics, logger, db } =
    getServerContext();
  const projectId = c.req.query('projectId');

  let pendingDecisions = 0,
    activeProjects = 1,
    activeWorkflows = 0;
  const recentEvents: { message: string; type: string; time: Date }[] = [];

  try {
    pendingDecisions = (projectId ? decisionRepo.listPending(projectId) : decisionRepo.listAllPending()).length;
  } catch (err) {
    logger.warn('Failed to load pending decisions', { error: (err as Error).message });
  }
  try {
    activeProjects = projectRepo.listAll().filter((p) => !p.archived).length;
  } catch (err) {
    logger.warn('Failed to load projects', { error: (err as Error).message });
  }
  try {
    const workflowRow = db
      .prepare("SELECT COUNT(*) as count FROM workflows WHERE status = 'running'")
      .get() as { count: number } | undefined;
    activeWorkflows = workflowRow?.count ?? 0;
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
  const { costTracker, db } = getServerContext();
  const days = parseInt(c.req.query('days') ?? '7', 10);
  const history: { date: string; cost: number; calls: number; tokens: number; byModel: Record<string, number> }[] =
    [];
  let totalCalls = 0;

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);

    // Per-model cost breakdown
    const byModel: Record<string, number> = {};
    try {
      const rows = db
        .prepare(
          "SELECT tags, SUM(value) as cost FROM metrics WHERE name = 'llm_cost' AND tags LIKE ? GROUP BY tags",
        )
        .all(`%${dateStr}%`) as any[];

      for (const row of rows) {
        // Extract model from tags JSON: {"model":"claude-sonnet-4-6",...}
        try {
          const tags = JSON.parse(row.tags ?? '{}');
          const model = tags.model ?? 'unknown';
          byModel[model] = (byModel[model] ?? 0) + parseFloat(row.cost ?? 0);
        } catch {
          byModel['unknown'] = (byModel['unknown'] ?? 0) + parseFloat(row.cost ?? 0);
        }
      }

      // Also get call count
      const callRow = db
        .prepare("SELECT SUM(value) as count FROM metrics WHERE name = 'llm_call' AND tags LIKE ?")
        .get(`%${dateStr}%`) as any;
      totalCalls += callRow?.count ?? 0;
    } catch {
      /* metrics aggregation error for this date */
    }

    const totalCost = Object.values(byModel).reduce((sum, c) => sum + c, 0);

    // Tokens for this day from session_metrics
    let tokens = 0;
    try {
      const tokenRow = db
        .prepare("SELECT SUM(total_tokens) as tokens FROM session_metrics WHERE started_at LIKE ?")
        .get(`${dateStr}%`) as any;
      tokens = tokenRow?.tokens ?? 0;
    } catch { /* ignore */ }

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
    limits: { daily: DAILY_BUDGET_USD, weekly: WEEKLY_BUDGET_USD, monthly: MONTHLY_BUDGET_USD },
  });
});
