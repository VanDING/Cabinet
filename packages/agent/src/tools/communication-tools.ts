import type { ToolDefinition } from '../tool-executor.js';

export interface CommunicationToolDeps {
  fetchRss: (
    url: string,
    limit?: number,
  ) => Promise<{
    entries: { title: string; link: string; pubDate?: string; content?: string }[];
  }>;
  sendEmail: (
    to: string,
    subject: string,
    body: string,
    bodyType?: 'text' | 'html',
  ) => Promise<{ sent: boolean; messageId?: string }>;
}

export function createCommunicationTools(deps: CommunicationToolDeps): ToolDefinition[] {
  return [
    {
      name: 'fetch_rss',
      description:
        'Fetch and parse an RSS or Atom feed from a URL. Returns recent entries with title, link, publication date, and content.',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the RSS/Atom feed' },
          limit: {
            type: 'integer',
            description: 'Maximum number of entries to return (default: 20)',
          },
        },
        required: ['url'],
      },
      execute: async (args: Record<string, unknown>) => {
        const url = args.url as string;
        const limit = args.limit as number | undefined;
        if (!url) return { error: 'url is required' };
        try {
          const result = await deps.fetchRss(url, limit);
          return { url, entries: result.entries };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'send_email',
      description:
        'Send an email via SMTP. Requires SMTP configuration to be set in system settings beforehand.',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body content' },
          body_type: {
            type: 'string',
            description: 'Format of the body: text or html (default: text)',
            enum: ['text', 'html'],
          },
        },
        required: ['to', 'subject', 'body'],
      },
      execute: async (args: Record<string, unknown>) => {
        const to = args.to as string;
        const subject = args.subject as string;
        const body = args.body as string;
        const bodyType = (args.body_type as 'text' | 'html') ?? 'text';
        if (!to) return { error: 'to is required' };
        if (!subject) return { error: 'subject is required' };
        try {
          const result = await deps.sendEmail(to, subject, body, bodyType);
          return { sent: result.sent, messageId: result.messageId };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
