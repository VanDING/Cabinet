import type { ToolDefinition } from '../tool-executor.js';

export interface WebToolDeps {
  webFetch: (url: string, maxLength?: number) => Promise<{
    content: string;
    contentType: string;
    status: number;
    title?: string;
  }>;
  httpRequest: (
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: string,
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  githubApiFetch?: (owner: string, repo: string, path?: string) => Promise<{
    content: string;
    items?: { name: string; path: string; type: string }[];
    error?: string;
  }>;
  cleanWebFetch?: (url: string, maxLength?: number) => Promise<{
    content: string;
    title?: string;
    error?: string;
  }>;
}

export function createWebTools(deps: WebToolDeps): ToolDefinition[] {
  return [
    {
      name: 'web_fetch',
      timeoutMs: 30000,
      execute: async (args: Record<string, unknown>) => {
        const url = args.url as string;
        const maxLength = args.max_length as number | undefined;
        if (!url) return { error: 'url is required' };
        try {
          const result = await deps.webFetch(url, maxLength);
          return {
            url,
            status: result.status,
            contentType: result.contentType,
            title: result.title,
            content: result.content,
            truncated: result.content.length < (maxLength ?? 10000),
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
    {
      name: 'fetch_github_repo',
      description: 'Fetch files or directory listings from a GitHub repository via the GitHub API.',
      execute: async (args: Record<string, unknown>) => {
        const owner = args.owner as string;
        const repo = args.repo as string;
        const path = args.path as string | undefined;
        if (!owner) return { error: 'owner is required' };
        if (!repo) return { error: 'repo is required' };
        if (!deps.githubApiFetch) return { error: 'GitHub API fetch not available' };
        try {
          const result = await deps.githubApiFetch(owner, repo, path);
          if (result.error) return { error: result.error };
          return {
            owner,
            repo,
            path: path ?? '',
            content: result.content,
            items: result.items,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'fetch_webpage_clean',
      description: 'Fetch a webpage and extract clean article text, removing navigation, ads, and clutter.',
      execute: async (args: Record<string, unknown>) => {
        const url = args.url as string;
        const maxLength = args.max_length as number | undefined;
        if (!url) return { error: 'url is required' };
        if (!deps.cleanWebFetch) return { error: 'Clean web fetch not available' };
        try {
          const result = await deps.cleanWebFetch(url, maxLength);
          if (result.error) return { error: result.error };
          return {
            url,
            title: result.title,
            content: result.content,
            truncated: result.content.length < (maxLength ?? 10000),
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
