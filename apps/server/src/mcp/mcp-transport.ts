import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export interface MCPTransportConfig {
  type: 'stdio' | 'sse';
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse
  url?: string;
  headers?: Record<string, string>;
}

export function createTransport(config: MCPTransportConfig): StdioClientTransport | SSEClientTransport {
  if (config.type === 'sse') {
    if (!config.url) {
      throw new Error('SSE transport requires a URL');
    }
    return new SSEClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    });
  }

  if (!config.command) {
    throw new Error('stdio transport requires a command');
  }

  return new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: config.env,
  } as any);
}
