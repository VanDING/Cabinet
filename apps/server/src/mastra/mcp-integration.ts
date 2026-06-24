import { MCPClient } from '@mastra/mcp';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CABINET_DIR } from '@cabinet/storage';

export { type MCPSideEffectRisk } from '@cabinet/types';

export interface MCPTransportConfig {
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface MCPServerConfig {
  name: string;
  transport: MCPTransportConfig;
  enabled: boolean;
  env?: Record<string, string>;
  rediscoverIntervalMinutes?: number;
}

export interface MCPTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sideEffectRisk: 'none' | 'readonly' | 'mutation' | 'destructive';
}

export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  error?: string;
}

export interface MCPIntegrationConfig {
  configs: MCPServerConfig[];
}

export class MCPIntegration {
  private clients = new Map<string, MCPClient>();
  private configs: MCPServerConfig[] = [];
  private toolsCache = new Map<string, Record<string, unknown>>();
  private logger: {
    info: (m: string, ctx?: Record<string, unknown>) => void;
    warn: (m: string, ctx?: Record<string, unknown>) => void;
  };

  constructor(logger: {
    info: (m: string, ctx?: Record<string, unknown>) => void;
    warn: (m: string, ctx?: Record<string, unknown>) => void;
  }) {
    this.logger = logger;
  }

  async initialize(configs: MCPServerConfig[]): Promise<void> {
    this.configs = configs;
    for (const cfg of configs) {
      if (!cfg.enabled) continue;
      try {
        await this.connectServer(cfg);
      } catch {
        this.logger.warn(`Failed to connect MCP server: ${cfg.name}`);
      }
    }
  }

  async connectServer(cfg: MCPServerConfig): Promise<void> {
    this.clients.get(cfg.name)?.disconnect?.();
    this.clients.delete(cfg.name);

    const servers: Record<string, unknown> = {};
    if (cfg.transport.type === 'sse' && cfg.transport.url) {
      servers[cfg.name] = { url: new URL(cfg.transport.url) };
    } else {
      servers[cfg.name] = {
        command: cfg.transport.command ?? 'npx',
        args: cfg.transport.args ?? [],
        env: { ...cfg.env, ...cfg.transport.env },
      };
    }

    const client = new MCPClient({ servers: servers as any, timeout: 60_000 });
    this.clients.set(cfg.name, client);

    const tools = await client.listTools();
    const count = Object.keys(tools).length;
    this.toolsCache.set(cfg.name, tools);
    this.logger.info(`MCP server connected: ${cfg.name} (${count} tools)`);
  }

  async updateConfigs(configs: MCPServerConfig[]): Promise<void> {
    this.configs = configs;
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
    this.toolsCache.clear();
    await this.initialize(configs);
  }

  listTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const [serverName, serverTools] of this.toolsCache) {
      for (const [name, _tool] of Object.entries(serverTools)) {
        tools.push({
          serverName,
          name,
          description: '',
          inputSchema: {},
          sideEffectRisk: 'readonly',
        });
      }
    }
    return tools;
  }

  getStatus(): MCPServerStatus[] {
    return this.configs.map((cfg) => {
      const client = this.clients.get(cfg.name);
      const connected = client !== undefined;
      return {
        name: cfg.name,
        connected,
        toolCount: connected ? this.listTools().filter((t) => t.serverName === cfg.name).length : 0,
        resourceCount: 0,
        promptCount: 0,
      };
    });
  }

  getConfigs(): MCPServerConfig[] {
    return this.configs;
  }

  getAgentTools(): Record<string, unknown> {
    const allTools: Record<string, unknown> = {};
    for (const [, client] of this.clients) {
      const toolsProxy = (client as any).toMCPServerProxies?.();
      if (toolsProxy) {
        Object.assign(allTools, toolsProxy);
      }
    }
    return allTools;
  }
}

export function loadMCPConfigs(dataDir: string): MCPServerConfig[] {
  const configs: MCPServerConfig[] = [];
  const mcpDir = join(dataDir, 'mcp');
  if (!existsSync(mcpDir)) return configs;

  try {
    const files = readdirSync(mcpDir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const cfg = JSON.parse(readFileSync(join(mcpDir, f), 'utf-8'));
        if (cfg.transport) {
          configs.push({
            name: cfg.name ?? f.replace('.json', ''),
            transport: cfg.transport,
            enabled: cfg.enabled !== false,
            env: cfg.env,
          });
        } else {
          configs.push({
            name: cfg.name ?? f.replace('.json', ''),
            transport: { type: 'stdio', command: cfg.command ?? 'npx', args: cfg.args ?? [] },
            enabled: cfg.enabled !== false,
          });
        }
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* mcp dir not accessible */
  }

  return configs;
}
