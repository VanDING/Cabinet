import { Hono } from 'hono';
import { getServerContext } from '../context.js';

const daemonRouter = new Hono();

daemonRouter.get('/status', (c) => {
  const { daemonRepo, logger } = getServerContext();
  try {
    const agents = daemonRepo.findOnlineDaemons(300_000);
    return c.json({ agents });
  } catch (err) {
    logger.warn('Failed to load daemon status', { error: String(err) });
    return c.json({ agents: [] });
  }
});

daemonRouter.get('/tasks', (c) => {
  const { taskQueueRepo, logger } = getServerContext();
  try {
    const tasks = taskQueueRepo.findByStatus(['pending', 'running']);
    return c.json({ tasks });
  } catch (err) {
    logger.warn('Failed to load daemon tasks', { error: String(err) });
    return c.json({ tasks: [] });
  }
});

daemonRouter.post('/tasks/:id/cancel', (c) => {
  const { taskQueueRepo, logger } = getServerContext();
  const id = c.req.param('id');
  try {
    taskQueueRepo.updateStatus(id, 'cancelled');
    logger.info('Daemon task cancelled', { id });
    return c.json({ status: 'cancelled' });
  } catch (err) {
    logger.warn('Failed to cancel daemon task', { id, error: String(err) });
    return c.json({ error: String(err) }, 500);
  }
});

daemonRouter.get('/ports', (c) => {
  const { logger } = getServerContext();
  try {
    return c.json({ ports: [] });
  } catch (err) {
    logger.warn('Failed to load daemon ports', { error: String(err) });
    return c.json({ ports: [] });
  }
});

daemonRouter.post('/ports/orphans/:port/kill', (c) => {
  const { logger } = getServerContext();
  const port = parseInt(c.req.param('port'), 10);
  logger.info('Port kill requested (no-op)', { port });
  return c.json({ status: 'killed' });
});

export { daemonRouter };
