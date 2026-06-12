import { watch } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { RulesWatcherDeps } from './types.js';

export function startRulesWatcher(dataDir: string, deps: RulesWatcherDeps): () => void {
  const rulesDir = join(dataDir, 'rules');

  if (!existsSync(rulesDir)) return () => {};

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const debouncedReload = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        deps.reloadRules();
        deps.logger.info('Rules reloaded from directory change');
      } catch (e: any) {
        deps.logger.info('Rules reload failed', { error: e.message });
      }
    }, 500);
  };

  const watcher = watch(rulesDir, { recursive: true }, (_eventType, _filename) => {
    debouncedReload();
  });

  deps.logger.info('Rules filesystem watcher started', { dir: rulesDir });

  return () => {
    watcher.close();
    deps.logger.info('Rules filesystem watcher stopped');
  };
}
