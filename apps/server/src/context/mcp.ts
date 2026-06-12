import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { MCPManager } from '../mcp/mcp-manager.js';
import type { BuildState } from './build-state.js';

export function initMcpManager(state: BuildState): void {
  const { db, settingsRepo, dataDir } = state;
  if (!db || !settingsRepo || !dataDir) {
    throw new Error('Missing required state for MCP manager');
  }

  const mcpManager = new MCPManager(state.logger!);
  try {
    const mcpConfigs: import('../mcp/mcp-manager.js').MCPServerConfig[] = [];
    const mcpDir = join(dataDir, 'mcp');
    try {
      const mcpFiles = readdirSync(mcpDir).filter((f) => f.endsWith('.json'));
      for (const f of mcpFiles) {
        try {
          const cfg = JSON.parse(readFileSync(join(mcpDir, f), 'utf-8'));
          mcpConfigs.push({
            name: cfg.name ?? f.replace('.json', ''),
            transport: {
              type: 'stdio',
              command: cfg.command ?? 'npx',
              args: cfg.args ?? [],
            },
            enabled: cfg.enabled ?? true,
          });
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* mcp dir empty */
    }

    try {
      const value = settingsRepo.get('mcp_servers');
      const dbConfigs = JSON.parse(value ?? '[]') as Array<Record<string, unknown>>;
      for (const dbCfg of dbConfigs) {
        const name = String(dbCfg.name ?? '');
        if (!name || mcpConfigs.some((fc) => fc.name === name)) continue;
        mcpConfigs.push({
          name,
          transport: {
            type: 'stdio',
            command: String(dbCfg.command ?? 'npx'),
            args: Array.isArray(dbCfg.args) ? (dbCfg.args as string[]) : [],
            env: dbCfg.env as Record<string, string> | undefined,
          },
          enabled: Boolean(dbCfg.enabled ?? true),
        });
      }
    } catch {
      /* db settings not available */
    }

    if (mcpConfigs.length > 0) {
      void mcpManager.initialize(mcpConfigs).catch(() => {
        state.logger?.info('MCP initialization failed — check server configs');
      });
    }
  } catch {
    state.logger?.info('MCP settings table not available — skipping MCP initialization');
  }

  state.mcpManager = mcpManager;
}
