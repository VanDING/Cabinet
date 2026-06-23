import { Hono } from 'hono';
import { getServerContext } from '../context.js';

const gcRouter = new Hono();

gcRouter.post('/scan', (c) => {
  const { sessionManager, db, logger } = getServerContext();
  const results: { cleaned: number; sessionsCleaned: number } = { cleaned: 0, sessionsCleaned: 0 };

  try {
    const info = db
      .prepare("DELETE FROM agent_daemon_heartbeats WHERE last_seen < datetime('now', '-1 day')")
      .run();
    results.cleaned = info.changes;
  } catch {
    /* table may not exist */
  }

  try {
    results.sessionsCleaned = sessionManager.cleanExpiredSessions();
  } catch {
    /* ignore cleanup errors */
  }

  logger.info('GC scan completed', results);
  return c.json(results);
});

export { gcRouter };
