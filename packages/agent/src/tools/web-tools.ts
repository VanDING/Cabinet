import type { ToolDefinition } from '../tool-executor.js';

export interface WebToolDeps {
  webFetch: (url: string) => Promise<{ content: string; contentType: string; status: number; title?: string }>;
  httpRequest: (
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: string,
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export function createWebTools(deps: WebToolDeps): ToolDefinition[] {
  return [
    {
      name: 'web_fetch',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const url = args.url as string;
        if (!url) return { error: 'url is required' };
        try {
          const result = await deps.webFetch(url);
          return {
            url,
            status: result.status,
            contentType: result.contentType,
            title: result.title,
            content: result.content.slice(0, 10000),
            truncated: result.content.length > 10000,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'http_request',
      execute: async (args: Record<string, unknown>) => {
        const method = ((args.method as string) ?? 'GET').toUpperCase();
        const url = args.url as string;
        if (!url) return { error: 'url is required' };

        const headers = (args.headers as Record<string, string>) ?? {};
        const body = args.body as string | undefined;

        try {
          const result = await deps.httpRequest(method, url, headers, body);
          return {
            status: result.status,
            headers: result.headers,
            body: result.body.slice(0, 50000),
            truncated: result.body.length > 50000,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
