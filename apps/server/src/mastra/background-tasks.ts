import { BackgroundTaskManager } from '@mastra/core/background-tasks';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const bgTaskManager = new BackgroundTaskManager({
  enabled: true,
  globalConcurrency: 3,
  perAgentConcurrency: 2,
  defaultTimeoutMs: 300_000,
});

bgTaskManager.registerStaticExecutor('executeCommand', {
  execute: async (args) => {
    const cmd = (args as { command?: string }).command ?? '';
    if (!cmd) return { output: '', exitCode: 1 };
    try {
      const out = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
      });
      return { output: out.slice(0, 100_000), exitCode: 0 };
    } catch (err: any) {
      return { output: err.stdout ?? err.stderr ?? String(err), exitCode: err.status ?? 1 };
    }
  },
});

bgTaskManager.registerStaticExecutor('readFile', {
  execute: async (args) => {
    const path = (args as { path?: string }).path ?? '';
    if (!path) return { content: '', error: 'No path provided' };
    try {
      const content = readFileSync(path, 'utf-8');
      return { content: content.slice(0, 500_000) };
    } catch (err) {
      return { content: '', error: String(err) };
    }
  },
});

bgTaskManager.registerStaticExecutor('search', {
  execute: async (args) => {
    const query = (args as { query?: string }).query ?? '';
    if (!query) return { results: [] };
    try {
      const isWindows = process.platform === 'win32';
      const cmd = isWindows
        ? `findstr /s /i /m /c:"${query}" *.ts *.tsx *.js`
        : `grep -rl --include="*.ts" --include="*.tsx" --include="*.js" "${query}" .`;
      const out = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return { results: out.split('\n').filter(Boolean).slice(0, 20) };
    } catch {
      return { results: [] };
    }
  },
});
