import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { type Logger } from '@cabinet/storage';

export interface MCPServerConfig {
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  enabled: boolean;
}

export interface MCPTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  error?: string;
}

export class MCPManager {
  private clients = new Map<string, Client>();
  private tools = new Map<string, MCPTool>();
  private configs: MCPServerConfig[] = [];

  constructor(private readonly logger: Logger) {}

  /** Load saved configs and connect to enabled servers. */
  async initialize(configs: MCPServerConfig[]): Promise<void> {
    this.configs = configs;
    for (const config of configs) {
      if (config.enabled) {
        try {
          await this.connectServer(config);
        } catch (e) {
          this.logger.warn('MCP server connect failed', { name: config.name, error: String(e) });
        }
      }
    }
    this.logger.info('MCP manager initialized', { servers: configs.length, connected: this.clients.size });
  }

  /** Connect to a single MCP server and register its tools. */
  async connectServer(config: MCPServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      await this.disconnectServer(config.name);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
    });

    const client = new Client(
      { name: 'cabinet', version: '2.0.0' },
      { capabilities: {} },
    );

    await client.connect(transport);

    // Discover and register tools
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const mcpTool: MCPTool = {
        serverName: config.name,
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      };
      this.tools.set(`mcp__${tool.name}`, mcpTool);
    }

    this.clients.set(config.name, client);
    this.logger.info('MCP server connected', { name: config.name, tools: tools.length });
  }

  /** Disconnect from a server and unregister its tools. */
  async disconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.close();
      this.clients.delete(name);
    }
    // Remove tools from this server
    for (const [key, tool] of this.tools) {
      if (tool.serverName === name) {
        this.tools.delete(key);
      }
    }
  }

  /** List all tools from all connected MCP servers. */
  listTools(): MCPTool[] {
    return [...this.tools.values()];
  }

  /** Call a tool by its MCP name (server routes to the right client). */
  async callTool(fullName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(fullName);
    if (!tool) throw new Error(`MCP tool not found: ${fullName}`);

    // Find the client for this tool's server
    const client = this.clients.get(tool.serverName);
    if (!client) throw new Error(`MCP server not connected: ${tool.serverName}`);

    const result = await client.callTool({
      name: tool.name,
      arguments: args,
    });
    return result;
  }

  /** Get connection status for all configured servers. */
  getStatus(): MCPServerStatus[] {
    return this.configs.map((config) => ({
      name: config.name,
      connected: this.clients.has(config.name),
      toolCount: [...this.tools.values()].filter((t) => t.serverName === config.name).length,
    }));
  }

  /** Get current configs for persistence. */
  getConfigs(): MCPServerConfig[] {
    return this.configs;
  }

  /** Update configs and reconnect changed servers. */
  async updateConfigs(configs: MCPServerConfig[]): Promise<void> {
    // Disconnect removed servers
    const newNames = new Set(configs.map((c) => c.name));
    for (const name of this.clients.keys()) {
      if (!newNames.has(name)) {
        await this.disconnectServer(name);
      }
    }
    this.configs = configs;
    // Reconnect changed servers
    for (const config of configs) {
      if (config.enabled && !this.clients.has(config.name)) {
        try {
          await this.connectServer(config);
        } catch (e) {
          this.logger.warn('MCP reconnect failed', { name: config.name, error: String(e) });
        }
      }
      if (!config.enabled && this.clients.has(config.name)) {
        await this.disconnectServer(config.name);
      }
    }
  }

  /** Shutdown all connections. */
  async shutdown(): Promise<void> {
    for (const name of this.clients.keys()) {
      await this.disconnectServer(name);
    }
  }
}
