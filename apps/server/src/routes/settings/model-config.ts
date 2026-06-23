import type { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { loadSettings, saveSettings } from './persistence.js';

export function registerModelConfigRoutes(router: Hono): void {
  router.get('/model-config', (c) => {
    const settings = loadSettings();
    const effectiveMapping = settings.modelMapping ?? {
      deep_reasoning: 'deepseek/deepseek-chat',
      default: 'deepseek/deepseek-chat',
      fast_execution: 'deepseek/deepseek-chat',
    };
    return c.json({
      providers: settings.providers ?? {},
      modelMapping: effectiveMapping,
    });
  });

  router.put('/model-config', async (c) => {
    const { logger } = getServerContext();
    const body = await c.req.json();

    if (body.providers !== undefined && typeof body.providers !== 'object') {
      return c.json({ error: 'providers must be an object' }, 400);
    }
    if (body.modelMapping !== undefined && typeof body.modelMapping !== 'object') {
      return c.json({ error: 'modelMapping must be an object' }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.providers !== undefined) updates.providers = body.providers;
    if (body.modelMapping !== undefined) updates.modelMapping = body.modelMapping;
    saveSettings(updates);
    logger.info('Model config saved', {
      providers: Object.keys(body.providers ?? {}),
      tiers: Object.keys(body.modelMapping ?? {}),
    });
    return c.json({ status: 'updated' });
  });
}
