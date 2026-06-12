import type { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { DEFAULT_PIS_CONFIG } from '@cabinet/types';
import { loadSettings, saveSettings, parseNum } from './persistence.js';

export function registerPisRoutes(router: Hono): void {
  router.get('/pis', (c) => {
    const settings = loadSettings();
    const cfg = (settings.pis as Record<string, unknown> | undefined) ?? DEFAULT_PIS_CONFIG;
    return c.json(cfg);
  });

  router.put('/pis', async (c) => {
    const { logger } = getServerContext();
    const body = await c.req.json();
    const weights = body.weights;
    const cfg = {
      enabled: body.enabled === true,
      mode: body.mode === 'intervene' ? 'intervene' : 'log_only',
      evaluationIntervalSteps: Math.max(
        1,
        Math.floor(
          parseNum(body.evaluationIntervalSteps, DEFAULT_PIS_CONFIG.evaluationIntervalSteps),
        ),
      ),
      weights:
        weights && typeof weights === 'object' && !Array.isArray(weights)
          ? {
              intentAlignment: Math.max(
                0,
                Math.min(
                  1,
                  parseNum(weights.intentAlignment, DEFAULT_PIS_CONFIG.weights!.intentAlignment),
                ),
              ),
              toolCoherence: Math.max(
                0,
                Math.min(
                  1,
                  parseNum(weights.toolCoherence, DEFAULT_PIS_CONFIG.weights!.toolCoherence),
                ),
              ),
              goalProgress: Math.max(
                0,
                Math.min(
                  1,
                  parseNum(weights.goalProgress, DEFAULT_PIS_CONFIG.weights!.goalProgress),
                ),
              ),
              contextStability: Math.max(
                0,
                Math.min(
                  1,
                  parseNum(weights.contextStability, DEFAULT_PIS_CONFIG.weights!.contextStability),
                ),
              ),
            }
          : DEFAULT_PIS_CONFIG.weights,
    };
    saveSettings({ pis: cfg });
    logger.info('PIS config updated', cfg);
    return c.json({ status: 'updated', ...cfg });
  });
}
