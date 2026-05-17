import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { totalmem, freemem, cpus, uptime as osUptime } from 'node:os';

export const healthRouter = new Hono();

healthRouter.get('/', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

healthRouter.get('/system', (c) => {
  const { db, metrics, backupManager } = getServerContext();

  const memUsage = process.memoryUsage();
  const totalMem = totalmem();
  const freeMem = freemem();
  const cpuInfo = cpus();

  let dbSize = 0;
  try {
    const row = db
      .prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()')
      .get() as any;
    dbSize = row?.size ?? 0;
  } catch {
    /* db size query failed */
  }

  const summary = metrics.getSummary();
  const uptime = process.uptime();

  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      uptime: { process: uptime, os: osUptime() },
      cpu: { cores: cpuInfo.length, model: cpuInfo[0]?.model ?? 'unknown' },
      memory: {
        processMB: (memUsage.heapUsed / 1024 / 1024).toFixed(1) + ' MB',
        systemTotalMB: (totalMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
        systemFreeMB: (freeMem / 1024 / 1024 / 1024).toFixed(1) + ' GB',
      },
      database: { sizeMB: (dbSize / 1024 / 1024).toFixed(1) + ' MB' },
    },
    metrics: summary,
    backup: backupManager ? { available: true } : { available: false },
  });
});
