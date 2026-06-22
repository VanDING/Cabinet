import { createMCPClient } from '@ai-sdk/mcp';

export interface MCPServerConfig {
  name: string;
  transport: {
    type: 'http' | 'sse';
    url: string;
    headers?: Record<string, string>;
  };
}

const activeClients = new Map<string, { client: any; tools: Record<string, unknown> }>();

export async function connectMCPServer(config: MCPServerConfig): Promise<Record<string, unknown>> {
  const cached = activeClients.get(config.name);
  if (cached) return cached.tools;

  const client = await createMCPClient({
    transport: {
      type: config.transport.type,
      url: config.transport.url,
      headers: config.transport.headers,
    },
  });

  const tools: Record<string, unknown> = {};
  const mcpTools = (await client.tools()) as Record<string, unknown>;
  for (const [name, t] of Object.entries(mcpTools)) {
    tools[name] = t;
  }

  activeClients.set(config.name, { client, tools });

  return tools;
}

export async function disconnectMCPServer(name: string): Promise<void> {
  const cached = activeClients.get(name);
  if (cached) {
    try {
      await cached.client.close();
    } catch {
      /* ignore */
    }
    activeClients.delete(name);
  }
}

export async function disconnectAllMCP(): Promise<void> {
  for (const [name] of activeClients) {
    await disconnectMCPServer(name);
  }
}

export function getConnectedMCPServers(): string[] {
  return Array.from(activeClients.keys());
}
