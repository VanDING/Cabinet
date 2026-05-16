import { Hono } from 'hono';
import { getServerContext } from '../context.js';

export const backupsRouter = new Hono();

backupsRouter.get('/', async (c) => {
  const { backupManager, logger } = getServerContext();
  if (!backupManager) return c.json({ backups: [], note: 'Backup manager not available' });

  try {
    const files = await backupManager.listBackups();
    return c.json({ backups: files });
  } catch (e) {
    logger.error('Failed to list backups', { error: String(e) });
    return c.json({ backups: [], error: (e as Error).message });
  }
});

backupsRouter.post('/', async (c) => {
  const { backupManager, logger } = getServerContext();
  if (!backupManager) return c.json({ error: 'Backup manager not available' }, 503);

  try {
    const path = await backupManager.backup();
    logger.info('Manual backup created', { path });
    return c.json({ status: 'created', path, timestamp: new Date().toISOString() });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

backupsRouter.post('/restore', async (c) => {
  const { backupManager, logger } = getServerContext();
  if (!backupManager) return c.json({ error: 'Backup manager not available' }, 503);
  const body = await c.req.json();
  const path = body.path as string;
  if (!path) return c.json({ error: 'path required' }, 400);

  // Validate path is within the backup directory to prevent path traversal
  const { join, resolve, normalize } = await import('node:path');
  const backupDir = resolve(join(process.cwd(), 'backups'));
  const resolvedPath = resolve(normalize(path));
  if (!resolvedPath.startsWith(backupDir)) {
    logger.warn('Backup restore blocked: path outside backup directory', { path, backupDir, resolvedPath });
    return c.json({ error: 'Invalid backup path' }, 403);
  }

  try {
    await backupManager.restore(resolvedPath);
    logger.info('Backup restored', { path: resolvedPath });
    return c.json({ status: 'restored', path: resolvedPath });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});
