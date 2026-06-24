import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const webFetchTool = createTool({
  id: 'webFetch',
  description: 'Fetch content from a URL. Returns the page text content (up to 50KB) with title.',
  inputSchema: z.object({
    url: z.string().url(),
  }),
  execute: async ({ url }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Cabinet/2.0' },
      });
      const html = await res.text();

      const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? res.url;
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/g, ' ')
        .replace(/\s{2,}/g, '\n')
        .trim();

      return {
        content: text.slice(0, 50_000),
        title,
        url: res.url,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
});

export const webSearchTool = createTool({
  id: 'webSearch',
  description:
    'Search the web using DuckDuckGo. Returns a list of results with title, snippet, and URL.',
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
        { signal: controller.signal },
      );
      const data = await res.json();
      const topics = (data as any).RelatedTopics ?? [];
      const results = topics
        .flatMap((t: any) => (t.Topics ? t.Topics : [t]))
        .slice(0, 8)
        .filter((r: any) => r.Text && r.FirstURL)
        .map((r: any) => ({
          title: r.Text?.split(' - ')[0] ?? '',
          snippet: r.Text ?? '',
          url: r.FirstURL ?? '',
        }));

      return { results, query };
    } catch (err) {
      return { results: [], query, error: String(err) };
    } finally {
      clearTimeout(timeout);
    }
  },
});
