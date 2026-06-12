import { watch } from 'node:fs';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { broadcast } from '../ws/handler.js';
import type { ProjectWatcherDeps } from './types.js';

export function startProjectWatcher(dataDir: string, deps: ProjectWatcherDeps): () => void {
  const projectsDir = join(dataDir, 'projects');

  if (!existsSync(projectsDir)) return () => {};

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const scan = () => {
    try {
      const files = readdirSync(projectsDir).filter((f) => f.endsWith('.json'));
      deps.logger.info('Project directory change detected', { fileCount: files.length });
      broadcast('project_dir_changed', { dir: projectsDir, fileCount: files.length });
    } catch {
      /* best-effort */
    }
  };

  const debouncedScan = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, 500);
  };

  const watcher = watch(projectsDir, { recursive: false }, (_eventType, _filename) => {
    debouncedScan();
  });

  deps.logger.info('Project filesystem watcher started', { dir: projectsDir });

  return () => {
    watcher.close();
    deps.logger.info('Project filesystem watcher stopped');
  };
}
