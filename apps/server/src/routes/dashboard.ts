import { Hono } from 'hono';
export const dashboardRouter = new Hono();

dashboardRouter.get('/summary', (c) => {
  return c.json({
    pendingDecisions: 0,
    todayCost: 0,
    activeProjects: 1,
    recentEvents: [],
  });
});
