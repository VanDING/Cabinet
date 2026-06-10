import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createTransport, type MCPTransportConfig } from './mcp-transport.js';
import { type Logger } from '@cabinet/storage';
import type { AuditLogger } from '@cabinet/decision';

export interface MCPServerConfig {
  name: string;
  transport: MCPTransportConfig;
  enabled: boolean;
  /** Environment variables to pass to the MCP server process. Supports ${VAR} substitution. */
  env?: Record<string, string>;
  /** Re-discovery interval in minutes (default 5). */
  rediscoverIntervalMinutes?: number;
}

import type { MCPSideEffectRisk } from '@cabinet/types';
export type { MCPSideEffectRisk };

export interface MCPTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sideEffectRisk: MCPSideEffectRisk;
}

export interface MCPResource {
  serverName: string;
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface MCPPrompt {
  serverName: string;
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface MCPServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  error?: string;
}

export class MCPManager {
  private clients = new Map<string, Client>();
  private tools = new Map<string, MCPTool>();
  private resources = new Map<string, MCPResource>();
  private prompts = new Map<string, MCPPrompt>();
  private configs: MCPServerConfig[] = [];
  private discoveryTimers = new Map<string, ReturnType<typeof setInterval>>();
  private auditLogger?: AuditLogger;

  constructor(private readonly logger: Logger) {}

  setAuditLogger(audit: AuditLogger): void {
    this.auditLogger = audit;
  }

  /** Get the side-effect risk classification for a given MCP tool. */
  getToolRisk(fullName: string): MCPSideEffectRisk | undefined {
    return this.tools.get(fullName)?.sideEffectRisk;
  }

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
    this.logger.info('MCP manager initialized', {
      servers: configs.length,
      connected: this.clients.size,
    });
  }

  /** Connect to a single MCP server and register its capabilities. */
  async connectServer(config: MCPServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      await this.disconnectServer(config.name);
    }

    const transport = createTransport(config.transport);
    const client = new Client({ name: 'cabinet', version: '2.0.0' }, { capabilities: {} });
    await client.connect(transport);

    // Discover tools with side-effect risk classification
    try {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        const risk = classifyToolRisk(tool);
        this.tools.set(`mcp__${tool.name}`, {
          serverName: config.name,
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
          sideEffectRisk: risk,
        });
      }
    } catch {
      // Server may not support tools
    }

    // Discover resources (4.4)
    try {
      const { resources } = await client.listResources();
      for (const res of resources) {
        this.resources.set(`mcp_res__${res.uri}`, {
          serverName: config.name,
          uri: res.uri,
          name: res.name,
          mimeType: res.mimeType,
          description: res.description,
        });
      }
    } catch {
      // Server may not support resources
    }

    // Discover prompts (4.4)
    try {
      const { prompts } = await client.listPrompts();
      for (const prompt of prompts) {
        this.prompts.set(`mcp_prompt__${prompt.name}`, {
          serverName: config.name,
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments,
        });
      }
    } catch {
      // Server may not support prompts
    }

    this.clients.set(config.name, client);
    this.logger.info('MCP server connected', {
      name: config.name,
      tools: this.toolsForServer(config.name).length,
      resources: this.resourcesForServer(config.name).length,
      prompts: this.promptsForServer(config.name).length,
    });

    // Schedule periodic re-discovery (4.4)
    const intervalMs = (config.rediscoverIntervalMinutes ?? 5) * 60 * 1000;
    const timer = setInterval(() => {
      this.rediscover(config.name).catch((err) =>
        this.logger.warn('MCP rediscover failed', { name: config.name, error: String(err) }),
      );
    }, intervalMs);
    this.discoveryTimers.set(config.name, timer);
  }

  /** Disconnect from a server and unregister its capabilities. */
  async disconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.close();
      this.clients.delete(name);
    }
    const timer = this.discoveryTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.discoveryTimers.delete(name);
    }
    // Remove capabilities from this server
    for (const [key, tool] of this.tools) {
      if (tool.serverName === name) this.tools.delete(key);
    }
    for (const [key, res] of this.resources) {
      if (res.serverName === name) this.resources.delete(key);
    }
    for (const [key, prompt] of this.prompts) {
      if (prompt.serverName === name) this.prompts.delete(key);
    }
  }

  /** List all tools from all connected MCP servers. */
  listTools(): MCPTool[] {
    return [...this.tools.values()];
  }

  /** List all resources from all connected MCP servers. */
  listResources(): MCPResource[] {
    return [...this.resources.values()];
  }

  /** List all prompts from all connected MCP servers. */
  listPrompts(): MCPPrompt[] {
    return [...this.prompts.values()];
  }

  /** Call a tool by its MCP name. */
  async callTool(fullName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(fullName);
    if (!tool) throw new Error(`MCP tool not found: ${fullName}`);
    const client = this.clients.get(tool.serverName);
    if (!client) throw new Error(`MCP server not connected: ${tool.serverName}`);

    // Audit log
    this.auditLogger?.log({
      entityType: 'mcp_tool',
      entityId: fullName,
      action: 'call',
      actor: 'agent',
      changes: { args, sideEffectRisk: tool.sideEffectRisk },
    });

    // Parameter validation for destructive tools: block file paths outside allowed directories
    if (tool.sideEffectRisk === 'destructive') {
      const pathArgs = Object.values(args).filter((v): v is string => typeof v === 'string' && (v.includes('/') || v.includes('\\')));
      for (const p of pathArgs) {
        if (isDisallowedPath(p)) {
          throw new Error(`MCP tool '${fullName}' blocked: path '${p}' is outside allowed directories`);
        }
      }
    }

    return client.callTool({ name: tool.name, arguments: args });
  }

  /** Read a resource by its URI. */
  async readResource(uri: string): Promise<unknown> {
    const res = this.resources.get(uri);
    if (!res) throw new Error(`MCP resource not found: ${uri}`);
    const client = this.clients.get(res.serverName);
    if (!client) throw new Error(`MCP server not connected: ${res.serverName}`);
    return client.readResource({ uri: res.uri });
  }

  /** Get a prompt by its name. */
  async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
    const prompt = this.prompts.get(name);
    if (!prompt) throw new Error(`MCP prompt not found: ${name}`);
    const client = this.clients.get(prompt.serverName);
    if (!client) throw new Error(`MCP server not connected: ${prompt.serverName}`);
    return client.getPrompt({ name: prompt.name, arguments: args });
  }

  /** Get connection status for all configured servers. */
  getStatus(): MCPServerStatus[] {
    return this.configs.map((config) => ({
      name: config.name,
      connected: this.clients.has(config.name),
      toolCount: this.toolsForServer(config.name).length,
      resourceCount: this.resourcesForServer(config.name).length,
      promptCount: this.promptsForServer(config.name).length,
    }));
  }

  /** Get current configs for persistence. */
  getConfigs(): MCPServerConfig[] {
    return this.configs;
  }

  /** Update configs and reconnect changed servers. */
  async updateConfigs(configs: MCPServerConfig[]): Promise<void> {
    const newNames = new Set(configs.map((c) => c.name));
    for (const name of this.clients.keys()) {
      if (!newNames.has(name)) {
        await this.disconnectServer(name);
      }
    }
    this.configs = configs;
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

  /** Re-discover capabilities from a connected server. */
  private async rediscover(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) return;

    // Tools
    try {
      const { tools } = await client.listTools();
      const oldToolNames = new Set(
        [...this.tools.values()].filter((t) => t.serverName === serverName).map((t) => t.name),
      );
      const newToolNames = new Set(tools.map((t) => t.name));

      for (const name of oldToolNames) {
        if (!newToolNames.has(name)) this.tools.delete(`mcp__${name}`);
      }
      for (const tool of tools) {
        const risk = classifyToolRisk(tool);
        this.tools.set(`mcp__${tool.name}`, {
          serverName,
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
          sideEffectRisk: risk,
        });
      }
    } catch {
      // ignore
    }

    // Resources
    try {
      const { resources } = await client.listResources();
      const oldResUris = new Set(
        [...this.resources.values()].filter((r) => r.serverName === serverName).map((r) => r.uri),
      );
      const newResUris = new Set(resources.map((r) => r.uri));

      for (const uri of oldResUris) {
        if (!newResUris.has(uri)) this.resources.delete(`mcp_res__${uri}`);
      }
      for (const res of resources) {
        this.resources.set(`mcp_res__${res.uri}`, {
          serverName,
          uri: res.uri,
          name: res.name,
          mimeType: res.mimeType,
          description: res.description,
        });
      }
    } catch {
      // ignore
    }

    // Prompts
    try {
      const { prompts } = await client.listPrompts();
      const oldPromptNames = new Set(
        [...this.prompts.values()].filter((p) => p.serverName === serverName).map((p) => p.name),
      );
      const newPromptNames = new Set(prompts.map((p) => p.name));

      for (const name of oldPromptNames) {
        if (!newPromptNames.has(name)) this.prompts.delete(`mcp_prompt__${name}`);
      }
      for (const prompt of prompts) {
        this.prompts.set(`mcp_prompt__${prompt.name}`, {
          serverName,
          name: prompt.name,
          description: prompt.description,
          arguments: prompt.arguments,
        });
      }
    } catch {
      // ignore
    }
  }

  /** Shutdown all connections. */
  async shutdown(): Promise<void> {
    for (const name of this.clients.keys()) {
      await this.disconnectServer(name);
    }
  }

  private toolsForServer(name: string): MCPTool[] {
    return [...this.tools.values()].filter((t) => t.serverName === name);
  }

  private resourcesForServer(name: string): MCPResource[] {
    return [...this.resources.values()].filter((r) => r.serverName === name);
  }

  private promptsForServer(name: string): MCPPrompt[] {
    return [...this.prompts.values()].filter((p) => p.serverName === name);
  }
}

// ── Tool risk classification ────────────────────────────────────

function classifyToolRisk(tool: { annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }): MCPSideEffectRisk {
  const annotations = tool.annotations;
  if (annotations?.destructiveHint) return 'destructive';
  if (annotations?.readOnlyHint) return 'readonly';
  // Conservative default: assume mutation risk if not annotated
  return 'mutation';
}

// ── Path validation ─────────────────────────────────────────────

const DISALLOWED_PATTERNS = [
  /\.\.\//,             // parent directory traversal
  /\/etc\//,            // system config
  /\/usr\/bin\//,       // system binaries
  /\.ssh\//,            // SSH keys
  /\.gnupg\//,          // GPG keys
  /\.aws\//,            // AWS credentials
  /\.env$/,             // env files
];

function isDisallowedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return DISALLOWED_PATTERNS.some((p) => p.test(normalized));
}
