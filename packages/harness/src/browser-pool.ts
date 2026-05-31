import type { Browser, BrowserContext, Page } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface BrowserPoolOptions {
  /** Max concurrent contexts. Default: 3 */
  maxContexts?: number;
  /** Browser to use. Default: 'chromium' */
  browser?: 'chromium' | 'firefox' | 'webkit';
}

interface SessionPage {
  context: BrowserContext;
  page: Page;
  lastUsedAt: number;
}

/** Auto-detect bundled Chromium for Tauri desktop builds. */
function detectBundledBrowsersPath(): string | undefined {
  // When running inside a Tauri-bundled server, the server-dist directory
  // may contain a `ms-playwright` folder copied by copy-server.mjs.
  const candidates = [
    join(process.cwd(), 'ms-playwright'),
    join(dirname(process.argv[1] ?? ''), 'ms-playwright'),
    join(dirname(process.execPath), 'ms-playwright'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) {
      const chromiumDirs = readdirSync(dir).filter((d) => d.startsWith('chromium-'));
      if (chromiumDirs.length > 0) return dir;
    }
  }
  return undefined;
}

/**
 * BrowserPool — reusable browser instances for Agent automation.
 *
 * Design constraints:
 * - Playwright Browser/Context/Page are not process-safe → managed in a single Node process.
 * - Multi-session server → each session gets an isolated Page via `sessionId`.
 * - Avoid launch/close per tool call (2-3s → ~200ms acquire).
 */
export class BrowserPool {
  private browser: Browser | null = null;
  private sessions = new Map<string, SessionPage>();
  private readonly maxContexts: number;
  private readonly browserType: 'chromium' | 'firefox' | 'webkit';
  private initialized = false;

  constructor(options: BrowserPoolOptions = {}) {
    this.maxContexts = options.maxContexts ?? 3;
    this.browserType = options.browser ?? 'chromium';
  }

  /** Launch the shared browser instance (idempotent). */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // For desktop builds, point Playwright to the bundled browser cache.
    const bundled = detectBundledBrowsersPath();
    if (bundled && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = bundled;
    }

    const { [this.browserType]: browserType } = await import('playwright');
    this.browser = await browserType.launch({ headless: true });
    this.initialized = true;
  }

  /** Acquire or create a page for the given sessionId. */
  async acquire(sessionId: string): Promise<Page> {
    await this.initialize();

    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.page;
    }

    if (this.sessions.size >= this.maxContexts) {
      throw new Error(
        `BrowserPool context limit reached (${this.maxContexts}). Close another session first.`,
      );
    }

    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const context = await this.browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    this.sessions.set(sessionId, { context, page, lastUsedAt: Date.now() });
    return page;
  }

  /** Release a session's page and context. */
  async release(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      await session.page.close();
    } catch {
      /* ignore */
    }
    try {
      await session.context.close();
    } catch {
      /* ignore */
    }
    this.sessions.delete(sessionId);
  }

  /** Shut down the entire browser instance and release all sessions. */
  async shutdown(): Promise<void> {
    for (const [sid] of this.sessions) {
      await this.release(sid);
    }
    this.sessions.clear();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* ignore */
      }
      this.browser = null;
    }
    this.initialized = false;
  }

  /** Remove idle sessions older than maxAgeMs. Returns count removed. */
  async pruneIdleSessions(maxAgeMs = 10 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [sid, session] of this.sessions) {
      if (now - session.lastUsedAt > maxAgeMs) {
        await this.release(sid);
        removed++;
      }
    }
    return removed;
  }

  /** Convenience: navigate and return title + url. */
  async navigate(
    sessionId: string,
    url: string,
    options?: { waitFor?: string },
  ): Promise<{ title: string; url: string }> {
    const page = await this.acquire(sessionId);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (options?.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 10000 });
    }
    return { title: await page.title(), url: page.url() };
  }

  /** Convenience: click an element. */
  async click(sessionId: string, selector: string): Promise<boolean> {
    const page = await this.acquire(sessionId);
    try {
      await page.click(selector);
      return true;
    } catch {
      return false;
    }
  }

  /** Convenience: type into an input. */
  async type(sessionId: string, selector: string, text: string, submit?: boolean): Promise<boolean> {
    const page = await this.acquire(sessionId);
    try {
      await page.fill(selector, text);
      if (submit) await page.press(selector, 'Enter');
      return true;
    } catch {
      return false;
    }
  }

  /** Convenience: read page text and links. */
  async read(
    sessionId: string,
    selector?: string,
  ): Promise<{ text: string; links: { text: string; href: string }[] }> {
    const page = await this.acquire(sessionId);
    let text = '';
    if (selector) {
      const el = await page.$(selector);
      text = el ? (await el.textContent()) ?? '' : '';
    } else {
      text = (await page.textContent('body')) ?? '';
    }
    const links = await page.$$eval('a', (as) =>
      as.map((a) => ({ text: a.textContent ?? '', href: a.href })),
    );
    return { text, links };
  }

  /** Convenience: take a screenshot (base64). */
  async screenshot(sessionId: string, selector?: string): Promise<{ base64: string; mimeType: string }> {
    const page = await this.acquire(sessionId);
    let buf: Buffer;
    if (selector) {
      const el = await page.$(selector);
      if (!el) throw new Error(`Selector not found: ${selector}`);
      buf = await el.screenshot();
    } else {
      buf = await page.screenshot({ fullPage: false });
    }
    return { base64: buf.toString('base64'), mimeType: 'image/png' };
  }

  /** Convenience: evaluate JS on the page. */
  async evaluate(sessionId: string, script: string): Promise<unknown> {
    const page = await this.acquire(sessionId);
    return page.evaluate((s) => {
      // eslint-disable-next-line no-eval
      return eval(s);
    }, script);
  }
}
