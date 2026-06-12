import type { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { loadSettings, saveSettings } from './persistence.js';

export function registerModelConfigRoutes(router: Hono): void {
  router.get('/model-config', (c) => {
    const settings = loadSettings();
    // Reflect the actual runtime modelMapping from the gateway if available,
    // otherwise fall back to settings.json, then to a reasonable default.
    const ctx = getServerContext();
    const gateway = ctx.gateway as any;
    const runtimeMapping = gateway?.modelMapping as Record<string, string> | undefined;
    const effectiveMapping = settings.modelMapping ??
      runtimeMapping ?? {
        deep_reasoning: 'anthropic/claude-opus-4-7',
        default: 'anthropic/claude-sonnet-4-6',
        fast_execution: 'anthropic/claude-haiku-4-5',
      };
    return c.json({
      providers: settings.providers ?? {},
      modelMapping: effectiveMapping,
    });
  });

  router.put('/model-config', async (c) => {
    const { refreshGateway, logger } = getServerContext();
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
    refreshGateway();
    logger.info('Model config updated', {
      providers: Object.keys(body.providers ?? {}),
      tiers: Object.keys(body.modelMapping ?? {}),
    });
    return c.json({ status: 'updated' });
  });
}
