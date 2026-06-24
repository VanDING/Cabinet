import type { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { saveSettings } from './persistence.js';
import type { MCPServerConfig, MCPTransportConfig } from '../../mastra/mcp-integration.js';

function normalizeMCPConfig(cfg: Record<string, unknown>): MCPServerConfig {
  const transport = cfg.transport;

  // New format: transport is an object { type, command?, url?, ... }
  if (transport && typeof transport === 'object' && !Array.isArray(transport)) {
    return {
      name: String(cfg.name ?? ''),
      transport: transport as MCPTransportConfig,
      enabled: cfg.enabled !== false,
    };
  }

  // Old flat format: command/args at top level
  return {
    name: String(cfg.name ?? ''),
    transport: {
      type: 'stdio',
      command: String(cfg.command ?? 'npx'),
      args: Array.isArray(cfg.args) ? (cfg.args as string[]) : [],
      env: cfg.env as Record<string, string> | undefined,
    },
    enabled: cfg.enabled !== false,
  };
}

function validateMCPConfig(cfg: MCPServerConfig): string | null {
  if (!cfg.name) return 'Server name is required';
  const t = cfg.transport;
  if (t.type === 'sse') {
    if (!t.url) return `SSE server "${cfg.name}" requires a URL`;
  } else {
    if (!t.command) return `stdio server "${cfg.name}" requires a command`;
  }
  return null;
}

export function registerMcpRoutes(router: Hono): void {
  router.get('/mcp-servers', (c) => {
    const { mcpManager } = getServerContext();
    return c.json({ servers: mcpManager.getStatus(), configs: mcpManager.getConfigs() });
  });

  router.put('/mcp-servers', async (c) => {
    const { mcpManager, settingsRepo, logger } = getServerContext();
    const body = await c.req.json();
    const rawConfigs: Array<Record<string, unknown>> = body.configs ?? [];

    // Normalize old flat format to new MCPTransportConfig format
    const configs = rawConfigs.map((cfg) => normalizeMCPConfig(cfg));

    // Validate
    for (const cfg of configs) {
      const err = validateMCPConfig(cfg);
      if (err) return c.json({ error: err }, 400);
    }

    // Persist to DB and settings.json
    settingsRepo.set('mcp_servers', JSON.stringify(configs));
    saveSettings({ mcpServers: configs });
    await mcpManager.updateConfigs(configs);
    logger.info('MCP servers updated', { count: configs.length });
    return c.json({ status: 'updated', servers: mcpManager.getStatus() });
  });

  router.post('/mcp-servers/test', async (c) => {
    const { mcpManager } = getServerContext();
    const body = await c.req.json();
    try {
      await mcpManager.connectServer(body);
      const tools = mcpManager.listTools().filter((t) => t.serverName === body.name);
      return c.json({ status: 'connected', toolCount: tools.length, tools });
    } catch (e) {
      return c.json({ status: 'error', error: (e as Error).message }, 500);
    }
  });
}
