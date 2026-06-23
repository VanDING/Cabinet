import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import {
  DAILY_BUDGET,
  WEEKLY_BUDGET,
  MONTHLY_BUDGET,
  MessageType,
  type DashboardSummary,
  type DashboardCostHistory,
  type DashboardAgentStatus,
} from '@cabinet/types';
import { broadcast } from '../ws/handler.js';

const EVENT_LABELS: Record<string, string> = {
  [MessageType.DecisionRequest]: 'Decision requested',
  [MessageType.DecisionResolved]: 'Decision resolved',
  [MessageType.TaskOrder]: 'Task ordered',
  [MessageType.TaskCompleted]: 'Task completed',
  [MessageType.TaskFailed]: 'Task failed',
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

function humanizeEventType(type: string): string {
  if (EVENT_LABELS[type]) return EVENT_LABELS[type]!;
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

let summaryCache: { data: DashboardSummary; timestamp: number } | null = null;
const SUMMARY_CACHE_TTL_MS = 10_000;

function getCachedSummary(factory: () => DashboardSummary): DashboardSummary {
  const now = Date.now();
  if (summaryCache && now - summaryCache.timestamp < SUMMARY_CACHE_TTL_MS) {
    return summaryCache.data;
  }
  const data = factory();
  summaryCache = { data, timestamp: now };
  return data;
}

let budgetAlerted = false;

export const dashboardRouter = new Hono();

dashboardRouter.get('/summary', (c) => {
  const { decisionRepo, projectRepo, workflowRepo, eventRepo, auditLogRepo, metrics, logger } =
    getServerContext();
  const projectId = c.req.query('projectId');

  const result = getCachedSummary(() => {
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
          message: humanizeEventType(e.messageType),
          type: e.messageType,
          time: e.timestamp,
        });
      }
    } catch (err) {
      logger.warn('Failed to load events', { error: (err as Error).message });
    }

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

    const summary: DashboardSummary = {
      pendingDecisions,
      todayCost: 0,
      activeProjects,
      activeWorkflows,
      recentEvents,
      budgetStatus: { daily: 0, weekly: 0, monthly: 0 },
      summary: metrics.getSummary(),
    };

    broadcast('dashboard:summary', summary as unknown as Record<string, unknown>);

    return summary;
  });

  return c.json(result);
});

dashboardRouter.get('/cost-history', (c) => {
  const { db, logger } = getServerContext();
  const days = parseInt(c.req.query('days') ?? '7', 10);
  const history: DashboardCostHistory['history'] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    history.push({ date: dateStr, cost: 0, calls: 0, tokens: 0, byModel: {} });
  }

  try {
    const rows = db
      .prepare(
        `SELECT date(timestamp) as date,
                SUM(cost_usd) as cost,
                SUM(prompt_tokens + completion_tokens) as tokens,
                COUNT(*) as calls
         FROM cost_history
         WHERE timestamp >= date('now', ?)
         GROUP BY date(timestamp)`,
      )
      .all(`-${days} days`) as Array<{
      date: string;
      cost: number;
      tokens: number;
      calls: number;
    }>;

    for (const row of rows) {
      const entry = history.find((h) => h.date === row.date);
      if (entry) {
        entry.cost = Math.round((row.cost ?? 0) * 10000) / 10000;
        entry.tokens = row.tokens ?? 0;
        entry.calls = row.calls ?? 0;
      }
    }
  } catch {
    /* cost_history table may be empty */
  }

  const dailyCost = history.length > 0 ? history[history.length - 1]!.cost : 0;
  const result: DashboardCostHistory = {
    history,
    dailyCost,
    budgetStatus: { daily: dailyCost, weekly: 0, monthly: 0 },
    limits: { daily: DAILY_BUDGET, weekly: WEEKLY_BUDGET, monthly: MONTHLY_BUDGET },
  };

  if (dailyCost > DAILY_BUDGET && !budgetAlerted) {
    budgetAlerted = true;
    broadcast('budget_alert', {
      dailyCost,
      budget: DAILY_BUDGET,
      message: 'Daily budget exceeded',
    });
  } else if (dailyCost <= DAILY_BUDGET) {
    budgetAlerted = false;
  }

  return c.json(result);
});

dashboardRouter.get('/agent-status', (c) => {
  const { agentRegistry, logger } = getServerContext();
  const agents: DashboardAgentStatus[] = [];

  try {
    const roles = agentRegistry.list?.() ?? [];
    for (const role of roles) {
      const isExternal = role.type === 'external_a2a' || role.type === 'external_cli';
      if (isExternal) {
        const hasConfig = role.external?.baseUrl || role.external?.command;
        agents.push({
          id: role.type,
          name: role.name ?? role.type,
          type: 'external',
          status: hasConfig ? 'unknown' : 'error',
          lastHeartbeatAt: undefined,
        });
      } else {
        agents.push({
          id: role.type,
          name: role.name ?? role.type,
          type: 'internal',
          status: 'online',
        });
      }
    }
  } catch (err) {
    logger.warn('Failed to load agent roles', { error: (err as Error).message });
  }

  return c.json({ agents });
});

dashboardRouter.get('/trends', (c) => {
  const { db, logger } = getServerContext();
  const days = parseInt(c.req.query('days') ?? '7', 10);

  const trends: import('@cabinet/types').DashboardTrendEntry[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    trends.push({
      date: d.toISOString().slice(0, 10),
      decisions: 0,
      workflows: 0,
      errors: 0,
      tasks: 0,
      sessions: 0,
    });
  }

  try {
    const decisionRows = db
      .prepare(
        `SELECT date(created_at) as date, COUNT(*) as count
         FROM decisions
         WHERE created_at >= date('now', ?)
         GROUP BY date(created_at)`,
      )
      .all(`-${days} days`) as Array<{ date: string; count: number }>;
    for (const row of decisionRows) {
      const entry = trends.find((t) => t.date === row.date);
      if (entry) entry.decisions = row.count ?? 0;
    }
  } catch (err) {
    logger.warn('Failed to load decision trends', { error: (err as Error).message });
  }

  try {
    const workflowRows = db
      .prepare(
        `SELECT date(started_at) as date, COUNT(*) as count
         FROM workflow_runs
         WHERE started_at >= date('now', ?)
         GROUP BY date(started_at)`,
      )
      .all(`-${days} days`) as Array<{ date: string; count: number }>;
    for (const row of workflowRows) {
      const entry = trends.find((t) => t.date === row.date);
      if (entry) entry.workflows = row.count ?? 0;
    }
  } catch (err) {
    logger.warn('Failed to load workflow trends', { error: (err as Error).message });
  }

  try {
    const sessionRows = db
      .prepare(
        `SELECT date(started_at) as date,
                COUNT(*) as sessions,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
         FROM session_metrics
         WHERE started_at >= date('now', ?)
         GROUP BY date(started_at)`,
      )
      .all(`-${days} days`) as Array<{ date: string; sessions: number; errors: number }>;
    for (const row of sessionRows) {
      const entry = trends.find((t) => t.date === row.date);
      if (entry) {
        entry.sessions = row.sessions ?? 0;
        entry.errors = row.errors ?? 0;
      }
    }
  } catch (err) {
    logger.warn('Failed to load session trends', { error: (err as Error).message });
  }

  return c.json({ trends });
});
