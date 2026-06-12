import { BrowserPool } from '@cabinet/harness';

let sharedBrowserPool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!sharedBrowserPool) {
    sharedBrowserPool = new BrowserPool({ maxContexts: 3 });
  }
  return sharedBrowserPool;
}

export function createBrowserCapabilities() {
  const pool = getBrowserPool();
  return {
    browserNavigate: async (sessionId: string, url: string, waitFor?: string) => {
      await pool.initialize();
      return pool.navigate(sessionId, url, { waitFor });
    },
    browserClick: async (sessionId: string, selector: string) => {
      return { clicked: await pool.click(sessionId, selector) };
    },
    browserType: async (sessionId: string, selector: string, text: string, submit?: boolean) => {
      return { typed: await pool.type(sessionId, selector, text, submit) };
    },
    browserRead: async (sessionId: string, selector?: string) => {
      return pool.read(sessionId, selector);
    },
    browserScreenshot: async (sessionId: string, selector?: string) => {
      return pool.screenshot(sessionId, selector);
    },
    browserEvaluate: async (sessionId: string, script: string) => {
      return { result: await pool.evaluate(sessionId, script) };
    },
  };
}
