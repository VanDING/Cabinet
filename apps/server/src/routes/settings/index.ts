import { Hono } from 'hono';
import { registerBudgetRoutes } from './budget.js';
import { registerApiKeyRoutes } from './api-keys.js';
import { registerDelegationTierRoutes } from './delegation-tier.js';
import { registerMcpRoutes } from './mcp.js';
import { registerModelConfigRoutes } from './model-config.js';
import { registerAdaptiveMonitorRoutes } from './adaptive-monitor.js';
import { registerPisRoutes } from './pis.js';

export const settingsRouter = new Hono();

registerBudgetRoutes(settingsRouter);
registerApiKeyRoutes(settingsRouter);
registerDelegationTierRoutes(settingsRouter);
registerMcpRoutes(settingsRouter);
registerModelConfigRoutes(settingsRouter);
registerAdaptiveMonitorRoutes(settingsRouter);
registerPisRoutes(settingsRouter);
