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
  type DashboardBudgetStatus,
} from '@cabinet/types';
import { broadcast } from '../ws/handler.js';

// Static EVENT_LABELS — new types fall back to humanized string (5.4)
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

/** Humanize an unknown event type: snake_case / camelCase → Title Case. */
function humanizeEventType(type: string): string {
  if (EVENT_LABELS[type]) return EVENT_LABELS[type]!;
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ── Simple in-memory cache for dashboard summary (5.5) ──
let summaryCache: { data: DashboardSummary; timestamp: number } | null = null;
const SUMMARY_CACHE_TTL_MS = 10_000; // 10 seconds

function getCachedSummary(factory: () => DashboardSummary): DashboardSummary {
  const now = Date.now();
  if (summaryCache && now - summaryCache.timestamp < SUMMARY_CACHE_TTL_MS) {
    return summaryCache.data;
  }
  const data = factory();
  summaryCache = { data, timestamp: now };
  return data;
}

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
  } = getServerContext();
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

    // Fallback: if event_log is empty, synthesise from audit_log
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

    const budgets = budgetGuard.checkAll();
    const budgetStatus: DashboardBudgetStatus = {
      daily: budgets.find((b) => b.period === 'daily')?.percentage ?? 0,
      weekly: budgets.find((b) => b.period === 'weekly')?.percentage ?? 0,
      monthly: budgets.find((b) => b.period === 'monthly')?.percentage ?? 0,
    };

    const summary: DashboardSummary = {
      pendingDecisions,
      todayCost: costTracker.getDailyCost(),
      activeProjects,
      activeWorkflows,
      recentEvents,
      budgetStatus,
      summary: metrics.getSummary(),
    };

    // WebSocket broadcast (5.1)
    broadcast('dashboard:summary', summary as unknown as Record<string, unknown>);

    return summary;
  });

  return c.json(result);
});

dashboardRouter.get('/cost-history', (c) => {
  const { costTracker, db } = getServerContext();
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

  const budgetStatus = costTracker
    ? {
        daily: costTracker.getDailyCost(),
        weekly: costTracker.getWeeklyCost?.() ?? 0,
        monthly: costTracker.getMonthlyCost?.() ?? 0,
      }
    : { daily: 0, weekly: 0, monthly: 0 };

  const result: DashboardCostHistory = {
    history,
    dailyCost: costTracker.getDailyCost(),
    budgetStatus,
    limits: { daily: DAILY_BUDGET, weekly: WEEKLY_BUDGET, monthly: MONTHLY_BUDGET },
  };

  return c.json(result);
});

// ── Agent Health Status (5.2) ──

dashboardRouter.get('/agent-status', (c) => {
  const { agentRegistry, daemon, logger } = getServerContext();
  const agents: DashboardAgentStatus[] = [];

  try {
    // Agents from registry — distinguish internal vs external
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

  try {
    // Daemon status
    if (daemon) {
      const status = daemon.getStatus?.();
      if (status) {
        for (const d of status.agents ?? []) {
          agents.push({
            id: d.agentId,
            name: d.agentId,
            type: 'daemon',
            status: d.status,
            lastHeartbeatAt: d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt) : undefined,
            activeTasks: d.activeTaskCount ?? 0,
          });
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to load daemon status', { error: (err as Error).message });
  }

  return c.json({ agents });
});
