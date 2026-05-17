import { Hono } from 'hono';
import { z } from 'zod';
import { getServerContext } from '../context.js';
import { BrowserVerifier } from '@cabinet/harness';

export const verifyRouter = new Hono();

const runSchema = z.object({
  baseUrl: z.string().default('http://localhost:5173'),
  checks: z.array(
    z.object({
      name: z.string(),
      path: z.string().optional(),
      expectedText: z.string().optional(),
      expectedElement: z.string().optional(),
      unexpectedElement: z.string().optional(),
      evaluate: z.string().optional(),
      waitFor: z.string().optional(),
      screenshot: z.boolean().optional(),
    }),
  ),
  headless: z.boolean().default(true),
});

// POST /api/verify/run — run browser verification checks
verifyRouter.post('/run', async (c) => {
  const { logger } = getServerContext();
  const body = await c.req.json().catch(() => ({}));
  const parsed = runSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error }, 400);

  const { baseUrl, checks, headless } = parsed.data;

  const verifier = new BrowserVerifier({
    baseUrl,
    headless,
    timeout: 15_000,
  });

  try {
    await verifier.launch();
    const report = await verifier.verify(checks);
    await verifier.close();

    logger.info('Verification run completed', {
      total: report.totalChecks,
      passed: report.passedCount,
      failed: report.failedCount,
    });

    return c.json({ report });
  } catch (e) {
    try {
      await verifier.close();
    } catch {
      /* verifier cleanup failed */
    }
    logger.error('Verification failed', { error: String(e) });
    return c.json({
      report: {
        timestamp: new Date().toISOString(),
        baseUrl,
        totalChecks: checks.length,
        passedCount: 0,
        failedCount: checks.length,
        results: checks.map((c) => ({
          checkName: c.name,
          passed: false,
          error: (e as Error).message,
          durationMs: 0,
        })),
        allPassed: false,
      },
      error: (e as Error).message,
    });
  }
});

// POST /api/verify/screenshot — take a single screenshot
verifyRouter.post('/screenshot', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const baseUrl = (body.baseUrl as string) ?? 'http://localhost:5173';
  const path = (body.path as string) ?? '/';
  const name = (body.name as string) ?? 'screenshot';

  const verifier = new BrowserVerifier({ baseUrl });
  try {
    await verifier.launch();
    await verifier.check({ name: 'navigate', path });
    const screenshotPath = await verifier.screenshot(name);
    await verifier.close();
    return c.json({ screenshotPath });
  } catch (e) {
    try {
      await verifier.close();
    } catch {
      /* verifier cleanup failed */
    }
    return c.json({ error: (e as Error).message }, 500);
  }
});
