import { watch } from 'node:fs';
import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { broadcast } from '../ws/handler.js';
import type { BlueprintWatcherDeps } from './types.js';
import { debounce } from './utils.js';

export function startBlueprintWatcher(dataDir: string, deps: BlueprintWatcherDeps): () => void {
  const blueprintsDir = join(dataDir, 'blueprints');
  if (!existsSync(blueprintsDir)) {
    try {
      mkdirSync(blueprintsDir, { recursive: true });
    } catch {
      /* ok */
    }
  }

  const fileTimestamps = new Map<string, number>();

  const scan = async () => {
    try {
      const files = readdirSync(blueprintsDir).filter(
        (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
      );

      for (const file of files) {
        const filePath = join(blueprintsDir, file);
        const stat = statSync(filePath);
        const prevMtime = fileTimestamps.get(filePath) ?? 0;

        if (stat.mtimeMs <= prevMtime) continue; // No change since last scan

        fileTimestamps.set(filePath, stat.mtimeMs);
        const content = readFileSync(filePath, 'utf-8');
        const error = await deps.onBlueprintChange(filePath, content);

        if (error) {
          deps.logger.warn('Blueprint hot-reload rejected — keeping old version', {
            file: filePath,
            error,
          });
          broadcast('blueprint_reload_failed', { file: filePath, error });
        } else {
          deps.logger.info('Blueprint hot-reloaded', { file: filePath });
          broadcast('blueprint_reloaded', { file: filePath, timestamp: new Date().toISOString() });
        }
      }
    } catch (err) {
      deps.logger.warn('Blueprint watcher scan failed', { error: (err as Error).message });
    }
  };

  const debouncedScan = debounce(scan, 500);

  const watcher = watch(blueprintsDir, { recursive: false }, (_eventType, _filename) => {
    debouncedScan();
  });

  deps.logger.info('Blueprint filesystem watcher started', { dir: blueprintsDir });

  // Initial scan
  scan();

  return () => {
    watcher.close();
    deps.logger.info('Blueprint filesystem watcher stopped');
  };
}
