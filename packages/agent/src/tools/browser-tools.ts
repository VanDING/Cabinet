import type { ToolDefinition } from '../tool-executor.js';

export interface BrowserToolDeps {
  browserNavigate: (
    sessionId: string,
    url: string,
    waitFor?: string,
  ) => Promise<{ title: string; url: string }>;
  browserClick: (sessionId: string, selector: string) => Promise<{ clicked: boolean }>;
  browserType: (
    sessionId: string,
    selector: string,
    text: string,
    submit?: boolean,
  ) => Promise<{ typed: boolean }>;
  browserRead: (
    sessionId: string,
    selector?: string,
  ) => Promise<{ text: string; links: { text: string; href: string }[] }>;
  browserScreenshot: (
    sessionId: string,
    selector?: string,
  ) => Promise<{ base64: string; mimeType: string }>;
  browserEvaluate: (sessionId: string, script: string) => Promise<{ result: unknown }>;
}

export function createBrowserTools(deps: BrowserToolDeps): ToolDefinition[] {
  return [
    {
      name: 'browser_navigate',
      description: 'Navigate the browser to a URL. Each session maintains its own page state.',
      timeoutMs: 30000,
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session identifier for page isolation',
          },
          url: { type: 'string', description: 'URL to navigate to' },
          wait_for: {
            type: 'string',
            description: 'Optional CSS selector to wait for before returning',
          },
        },
        required: ['session_id', 'url'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.session_id as string;
        const url = args.url as string;
        const waitFor = args.wait_for as string | undefined;
        if (!sessionId) return { error: 'session_id is required' };
        if (!url) return { error: 'url is required' };
        try {
          const result = await deps.browserNavigate(sessionId, url, waitFor);
          return { session_id: sessionId, title: result.title, url: result.url };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'browser_click',
      description: 'Click an element on the current page by CSS selector.',
      timeoutMs: 15000,
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Session identifier' },
          selector: { type: 'string', description: 'CSS selector of the element to click' },
        },
        required: ['session_id', 'selector'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.session_id as string;
        const selector = args.selector as string;
        if (!sessionId) return { error: 'session_id is required' };
        if (!selector) return { error: 'selector is required' };
        try {
          const result = await deps.browserClick(sessionId, selector);
          return { session_id: sessionId, selector, clicked: result.clicked };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'browser_type',
      description: 'Type text into an input field by CSS selector.',
      timeoutMs: 15000,
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Session identifier' },
          selector: { type: 'string', description: 'CSS selector of the input field' },
          text: { type: 'string', description: 'Text to type' },
          submit: {
            type: 'boolean',
            description: 'Press Enter after typing (default: false)',
          },
        },
        required: ['session_id', 'selector', 'text'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.session_id as string;
        const selector = args.selector as string;
        const text = args.text as string;
        const submit = args.submit === true;
        if (!sessionId) return { error: 'session_id is required' };
        if (!selector) return { error: 'selector is required' };
        try {
          const result = await deps.browserType(sessionId, selector, text, submit);
          return { session_id: sessionId, selector, typed: result.typed };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'browser_read',
      description: 'Read text content and links from the current page, or from a specific element.',
      timeoutMs: 15000,
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Session identifier' },
          selector: {
            type: 'string',
            description: 'Optional CSS selector to restrict reading to a specific element',
          },
        },
        required: ['session_id'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.session_id as string;
        const selector = args.selector as string | undefined;
        if (!sessionId) return { error: 'session_id is required' };
        try {
          const result = await deps.browserRead(sessionId, selector);
          return { session_id: sessionId, text: result.text, links: result.links };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'browser_screenshot',
      description:
        'Take a screenshot of the current page or a specific element. Returns base64 PNG.',
      timeoutMs: 15000,
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Session identifier' },
          selector: {
            type: 'string',
            description: 'Optional CSS selector to screenshot a specific element',
          },
        },
        required: ['session_id'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.session_id as string;
        const selector = args.selector as string | undefined;
        if (!sessionId) return { error: 'session_id is required' };
        try {
          const result = await deps.browserScreenshot(sessionId, selector);
          return {
            session_id: sessionId,
            base64: result.base64,
            mimeType: result.mimeType,
          };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
    {
      name: 'browser_evaluate',
      description:
        'Execute JavaScript on the current page and return the result. Use with caution.',
      timeoutMs: 15000,
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Session identifier' },
          script: { type: 'string', description: 'JavaScript code to evaluate' },
        },
        required: ['session_id', 'script'],
      },
      execute: async (args: Record<string, unknown>) => {
        const sessionId = args.session_id as string;
        const script = args.script as string;
        if (!sessionId) return { error: 'session_id is required' };
        if (!script) return { error: 'script is required' };
        try {
          const result = await deps.browserEvaluate(sessionId, script);
          return { session_id: sessionId, result };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    },
  ];
}
