import { Hono } from 'hono';
import { getServerContext } from '../context.js';

const harnessRouter = new Hono();

harnessRouter.get('/overview', (c) => {
  const { daemonRepo, taskQueueRepo, sessionManager, logger } = getServerContext();
  try {
    const agents = daemonRepo ? daemonRepo.findOnlineDaemons(300_000) : [];
    const tasks = taskQueueRepo
      ? taskQueueRepo.findByStatus(['pending', 'running', 'completed', 'failed'])
      : [];
    const sessions = sessionManager.list();
    const activeSessions = sessions.filter((s) => s.status === 'active' || !s.status).length;

    return c.json({
      agents: agents.length,
      activeSessions,
      pendingTasks: tasks.filter((t: any) => t.status === 'pending').length,
      runningTasks: tasks.filter((t: any) => t.status === 'running').length,
      totalTasks: tasks.length,
    });
  } catch (err) {
    logger.warn('Failed to load harness overview', { error: String(err) });
    return c.json({
      agents: 0,
      activeSessions: 0,
      pendingTasks: 0,
      runningTasks: 0,
      totalTasks: 0,
    });
  }
});

export { harnessRouter };
