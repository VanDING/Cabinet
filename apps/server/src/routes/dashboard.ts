import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const dashboardRouter = new Hono();

dashboardRouter.get('/summary', (c) => {
  const { decisionRepo, costTracker, budgetGuard, projectRepo, eventRepo, metrics } = getServerContext();
  const projectId = c.req.query('projectId') ?? 'proj-1';

  let pendingDecisions = 0, activeProjects = 1, activeWorkflows = 0;
  const recentEvents: { message: string; time: Date }[] = [];

  try { pendingDecisions = decisionRepo.listPending(projectId).length; } catch {}
  try { activeProjects = projectRepo.listByOrganization('org-1').length; } catch {}
  try {
    const events = eventRepo.findAll().slice(-10);
    for (const e of events) {
      recentEvents.push({ message: e.messageType, time: e.timestamp });
    }
  } catch {}

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
