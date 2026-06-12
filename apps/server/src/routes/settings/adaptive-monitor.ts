import type { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { DEFAULT_ADAPTIVE_MONITOR_CONFIG } from '@cabinet/types';
import { loadSettings, saveSettings, parseNum } from './persistence.js';

export function registerAdaptiveMonitorRoutes(router: Hono): void {
  router.get('/adaptive-monitor', (c) => {
    const settings = loadSettings();
    const cfg =
      (settings.adaptiveMonitor as Record<string, unknown> | undefined) ??
      DEFAULT_ADAPTIVE_MONITOR_CONFIG;
    return c.json(cfg);
  });

  router.put('/adaptive-monitor', async (c) => {
    const { logger } = getServerContext();
    const body = await c.req.json();
    const cfg = {
      enabled: body.enabled === true,
      explorationRate: Math.max(
        0,
        Math.min(
          1,
          parseNum(body.explorationRate, DEFAULT_ADAPTIVE_MONITOR_CONFIG.explorationRate),
        ),
      ),
      lookbackDays: Math.max(
        1,
        Math.floor(parseNum(body.lookbackDays, DEFAULT_ADAPTIVE_MONITOR_CONFIG.lookbackDays)),
      ),
      minSamplesPerZone: Math.max(
        1,
        Math.floor(
          parseNum(body.minSamplesPerZone, DEFAULT_ADAPTIVE_MONITOR_CONFIG.minSamplesPerZone),
        ),
      ),
      hardLimits: {
        smartZoneMin: Math.max(
          0,
          Math.min(
            1,
            parseNum(
              body.hardLimits?.smartZoneMin,
              DEFAULT_ADAPTIVE_MONITOR_CONFIG.hardLimits.smartZoneMin,
            ),
          ),
        ),
        criticalThresholdMax: Math.max(
          0,
          Math.min(
            1,
            parseNum(
              body.hardLimits?.criticalThresholdMax,
              DEFAULT_ADAPTIVE_MONITOR_CONFIG.hardLimits.criticalThresholdMax,
            ),
          ),
        ),
      },
    };
    saveSettings({ adaptiveMonitor: cfg });
    logger.info('Adaptive monitor config updated', cfg);
    return c.json({ status: 'updated', ...cfg });
  });
}
