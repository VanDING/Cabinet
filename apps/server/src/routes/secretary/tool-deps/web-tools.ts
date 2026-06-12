import { isInternalIP } from '../../../utils/net-utils.js';
import { extractTitle } from '../../../utils/text-utils.js';

export function buildWebTools() {
  return {
    webFetch: async (url: string, maxLength?: number) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0 WebFetcher' },
          redirect: 'follow',
        });
        const contentType = res.headers.get('content-type') ?? 'text/plain';
        const text = await res.text();
        const limit = maxLength ?? 10000;
        let content = text;
        if (contentType.includes('html')) {
          content = text
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
            .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
            .replace(/<header[\s\S]*?<\/header>/gi, ' ')
            .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
            .replace(/<\/?.[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
        const truncated = content.slice(0, Math.min(limit, 2 * 1024 * 1024));
        const title = extractTitle(text, contentType);
        return { content: truncated, contentType, status: res.status, title };
      } finally {
        clearTimeout(timer);
      }
    },

    httpRequest: async (
      method: string,
      url: string,
      headers?: Record<string, string>,
      body?: string,
    ) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');
      if (body && body.length > 1 * 1024 * 1024) throw new Error('Request body exceeds 1MB limit');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(url, {
          method,
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0', ...headers },
          body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
          redirect: 'follow',
        });
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => {
          resHeaders[k] = v;
        });
        const resBody = await res.text();
        return {
          status: res.status,
          headers: resHeaders,
          body: resBody.slice(0, 50 * 1024 * 1024),
        };
      } finally {
        clearTimeout(timer);
      }
    },

    githubApiFetch: async (owner: string, repo: string, path?: string) => {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path ?? ''}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(apiUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0', Accept: 'application/vnd.github.v3+json' },
        });
        if (!res.ok)
          return { content: '', error: `GitHub API error: ${res.status} ${res.statusText}` };
        const data = await res.json();
        if (Array.isArray(data)) {
          const items = data.map((item: any) => ({
            name: item.name,
            path: item.path,
            type: item.type,
          }));
          return {
            content:
              `Directory listing for ${path ?? 'root'}:\n` +
              items.map((i: any) => `- ${i.type}: ${i.name}`).join('\n'),
            items,
          };
        }
        if (data.content && data.encoding === 'base64') {
          return { content: Buffer.from(data.content, 'base64').toString('utf-8').slice(0, 50000) };
        }
        return { content: JSON.stringify(data, null, 2) };
      } finally {
        clearTimeout(timer);
      }
    },

    cleanWebFetch: async (url: string, maxLength?: number) => {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol))
        throw new Error('Only HTTP/HTTPS URLs are allowed');
      if (isInternalIP(parsed.hostname)) throw new Error('Internal IP addresses are not allowed');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Cabinet/2.0 WebFetcher' },
          redirect: 'follow',
        });
        const text = await res.text();
        const title = extractTitle(text, res.headers.get('content-type') ?? 'text/plain');
        const cleaned = text
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
          .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
          .replace(/<header[\s\S]*?<\/header>/gi, ' ')
          .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
          .replace(/<\/?.[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { content: cleaned.slice(0, maxLength ?? 10000), title };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
