//
// Browser Verifier — independent end-to-end verification via browser automation.
//
// Inspired by Anthropic's Playwright MCP integration for the Evaluator agent.
// The key insight from the article: "让 Agent 像用户一样验证功能" — the agent
// should verify features by actually using them, not just reading code.
//
// This provides the INDEPENDENT verification perspective that Böckeler
// identified as missing when teams rely on "AI checking AI."
//
// Uses Playwright to:
//   - Launch a browser and navigate to the running app
//   - Take DOM snapshots and screenshots
//   - Check for expected text, elements, and states
//   - Run simple user interaction flows
//
// Designed to be called from the Evaluator (separate agent, independent context)
// — not from the Generator that produced the code being verified.
//

import type { Browser, BrowserContext, Page } from 'playwright';

// ── Types ──────────────────────────────────────────────────────

export interface BrowserVerifierOptions {
  /** App base URL (e.g., http://localhost:5173). */
  baseUrl: string;
  /** Browser to launch. Defaults to 'chromium'. */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /** Run in headless mode. Defaults to true. */
  headless?: boolean;
  /** Timeout per check in ms. Defaults to 10000. */
  timeout?: number;
  /** Directory for screenshots. If omitted, no screenshots saved. */
  screenshotDir?: string;
}

export interface VerificationCheck {
  /** Description of what this check verifies. */
  name: string;
  /** URL path to navigate to (appended to baseUrl). */
  path?: string;
  /** Expected text to find on the page. */
  expectedText?: string;
  /** Expected element selector to find. */
  expectedElement?: string;
  /** CSS selector that should NOT be present. */
  unexpectedElement?: string;
  /** JS expression to evaluate on the page. Must return true to pass. */
  evaluate?: string;
  /** Wait for this selector before checking. */
  waitFor?: string;
  /** Take a screenshot after this check. */
  screenshot?: boolean;
}

export interface VerificationResult {
  checkName: string;
  passed: boolean;
  error?: string;
  screenshotPath?: string;
  /** DOM snapshot text at check time (first 500 chars). */
  domPreview?: string;
  durationMs: number;
}

export interface VerificationReport {
  timestamp: string;
  baseUrl: string;
  totalChecks: number;
  passedCount: number;
  failedCount: number;
  results: VerificationResult[];
  /** Overall pass (true when all checks passed). */
  allPassed: boolean;
}

// ── Browser Verifier ──────────────────────────────────────────

export class BrowserVerifier {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly options: Required<BrowserVerifierOptions>;

  constructor(options: BrowserVerifierOptions) {
    this.options = {
      baseUrl: options.baseUrl,
      browser: options.browser ?? 'chromium',
      headless: options.headless ?? true,
      timeout: options.timeout ?? 10_000,
      screenshotDir: options.screenshotDir ?? '',
    };
  }

  /** Launch browser and create context. */
  async launch(): Promise<void> {
    // Dynamic import — Playwright is only loaded when actually needed
    const { [this.options.browser]: browserType } = await import('playwright');
    this.browser = await browserType.launch({ headless: this.options.headless });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    this.page = await this.context.newPage();
  }

  /** Close browser and clean up. */
  async close(): Promise<void> {
    await this.page?.close();
    await this.context?.close();
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  /** Run a set of verification checks and produce a report. */
  async verify(checks: VerificationCheck[]): Promise<VerificationReport> {
    const started = await this.ensureBrowser();
    if (!started) {
      return {
        timestamp: new Date().toISOString(),
        baseUrl: this.options.baseUrl,
        totalChecks: checks.length,
        passedCount: 0,
        failedCount: checks.length,
        results: checks.map(c => ({
          checkName: c.name,
          passed: false,
          error: 'Browser failed to launch',
          durationMs: 0,
        })),
        allPassed: false,
      };
    }

    const results: VerificationResult[] = [];

    for (const check of checks) {
      const start = Date.now();
      try {
        const result = await this.runCheck(check);
        result.durationMs = Date.now() - start;
        results.push(result);
      } catch (err) {
        results.push({
          checkName: check.name,
          passed: false,
          error: (err as Error).message,
          durationMs: Date.now() - start,
        });
      }
    }

    const passedCount = results.filter(r => r.passed).length;
    return {
      timestamp: new Date().toISOString(),
      baseUrl: this.options.baseUrl,
      totalChecks: checks.length,
      passedCount,
      failedCount: checks.length - passedCount,
      results,
      allPassed: passedCount === checks.length,
    };
  }

  /** Run a single check and return a pass/fail result. */
  async check(check: VerificationCheck): Promise<VerificationResult> {
    const start = Date.now();
    await this.ensureBrowser();
    try {
      const result = await this.runCheck(check);
      result.durationMs = Date.now() - start;
      return result;
    } catch (err) {
      return {
        checkName: check.name,
        passed: false,
        error: (err as Error).message,
        durationMs: Date.now() - start,
      };
    }
  }

  /** Take a screenshot of the current page. */
  async screenshot(name: string): Promise<string | null> {
    if (!this.page || !this.options.screenshotDir) return null;
    try {
      const { mkdirSync, existsSync } = await import('node:fs');
      if (!existsSync(this.options.screenshotDir)) {
        mkdirSync(this.options.screenshotDir, { recursive: true });
      }
      const path = `${this.options.screenshotDir}/${name}-${Date.now()}.png`;
      await this.page.screenshot({ path, fullPage: true });
      return path;
    } catch {
      return null;
    }
  }

  /** Get current page text content (for DOM previews in reports). */
  async getPageText(): Promise<string> {
    if (!this.page) return '';
    try {
      return await this.page.textContent('body') ?? '';
    } catch {
      return '';
    }
  }

  // ── Private ────────────────────────────────────────────────

  private async ensureBrowser(): Promise<boolean> {
    if (this.page) return true;
    try {
      await this.launch();
      return true;
    } catch {
      return false;
    }
  }

  private async runCheck(check: VerificationCheck): Promise<VerificationResult> {
    const page = this.page!;
    const timeout = this.options.timeout;

    // Navigate
    if (check.path) {
      await page.goto(`${this.options.baseUrl}${check.path}`, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
    }

    // Wait for element if specified
    if (check.waitFor) {
      await page.waitForSelector(check.waitFor, { timeout });
    }

    // Check expected element
    if (check.expectedElement) {
      const el = await page.$(check.expectedElement);
      if (!el) {
        return {
          checkName: check.name,
          passed: false,
          error: `Expected element "${check.expectedElement}" not found on page.`,
          domPreview: (await this.getPageText()).slice(0, 500),
          durationMs: 0,
        };
      }
    }

    // Check unexpected element
    if (check.unexpectedElement) {
      const el = await page.$(check.unexpectedElement);
      if (el) {
        return {
          checkName: check.name,
          passed: false,
          error: `Unexpected element "${check.unexpectedElement}" found on page.`,
          domPreview: (await this.getPageText()).slice(0, 500),
          durationMs: 0,
        };
      }
    }

    // Check expected text
    if (check.expectedText) {
      const pageText = await page.textContent('body');
      if (!pageText?.includes(check.expectedText)) {
        return {
          checkName: check.name,
          passed: false,
          error: `Expected text "${check.expectedText}" not found on page.`,
          domPreview: pageText?.slice(0, 500) ?? '',
          durationMs: 0,
        };
      }
    }

    // Evaluate JS expression
    if (check.evaluate) {
      try {
        const result = await page.evaluate(check.evaluate);
        if (result !== true) {
          return {
            checkName: check.name,
            passed: false,
            error: `JS evaluate returned: ${JSON.stringify(result)} (expected true).`,
            domPreview: (await this.getPageText()).slice(0, 500),
            durationMs: 0,
          };
        }
      } catch (err) {
        return {
          checkName: check.name,
          passed: false,
          error: `JS evaluate error: ${(err as Error).message}`,
          durationMs: 0,
        };
      }
    }

    // Screenshot
    let screenshotPath: string | undefined;
    if (check.screenshot) {
      screenshotPath = (await this.screenshot(check.name.replace(/\s+/g, '-'))) ?? undefined;
    }

    return {
      checkName: check.name,
      passed: true,
      screenshotPath,
      domPreview: (await this.getPageText()).slice(0, 500),
      durationMs: 0,
    };
  }
}
