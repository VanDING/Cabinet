import { Hono } from 'hono';
import { getServerContext } from '../context.js';
import { GarbageCollector } from '@cabinet/harness';

export const gcRouter = new Hono();

// POST /api/gc/scan — run a garbage collection scan
gcRouter.post('/scan', async (c) => {
  const { eventBus, logger } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const autoFix = body.autoFix === true;

  try {
    // Navigate from server/dist/ to project root
    const { join } = await import('node:path');
    const projectRoot = join(process.cwd(), '..', '..', '..');
    const gc = new GarbageCollector(eventBus, {
      rootDir: projectRoot,
      autoFix,
    });

    const report = await gc.collect();
    const summary = GarbageCollector.summarize(report);

    logger.info('GC scan completed', {
      total: report.summary.total,
      errors: report.summary.errors,
      warnings: report.summary.warnings,
    });

    return c.json({
      report,
      summary,
      autoFix,
    });
  } catch (e) {
    logger.error('GC scan failed', { error: String(e) });
    return c.json({ error: (e as Error).message }, 500);
  }
});
