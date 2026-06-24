import { MCPIntegration, loadMCPConfigs } from '../mastra/mcp-integration.js';
import type { BuildState } from './build-state.js';

export function initMcpManager(state: BuildState): void {
  const { dataDir } = state;
  if (!dataDir) {
    throw new Error('Missing dataDir for MCP manager');
  }

  const mcpManager = new MCPIntegration(state.logger!);
  try {
    const configs = loadMCPConfigs(dataDir);
    if (configs.length > 0) {
      void mcpManager.initialize(configs).catch(() => {
        state.logger?.info('MCP initialization failed — check server configs');
      });
    }
  } catch {
    state.logger?.info('MCP settings not available — skipping MCP initialization');
  }

  state.mcpManager = mcpManager;
}
