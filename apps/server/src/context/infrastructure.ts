import { join } from 'node:path';
import { SessionManager } from '@cabinet/secretary';
import { MetricsCollector, BackupManager } from '@cabinet/storage';
import { A2AClient } from '../a2a/a2a-client.js';
import type { BuildState } from './types.js';

export function initInfrastructure(state: BuildState): void {
  const { db, metricRepo, settingsRepo, eventBus, dataDir, dbPath } = state;
  if (!db || !metricRepo || !settingsRepo || !eventBus || !dataDir || !dbPath) {
    throw new Error('Missing required state for infrastructure');
  }

  const sessionManager = new SessionManager();

  const metrics = new MetricsCollector({ repo: metricRepo });
  metrics.startPeriodicFlush();

  let backupManager: BackupManager | null = null;
  try {
    backupManager = new BackupManager({
      dbPath,
      backupDir: join(dataDir, 'backups'),
      intervalMinutes: 60,
      keepCount: 7,
      liveConnection: db,
    });
    backupManager.startAutoBackup();
    setTimeout(
      () => {
        backupManager!.runMaintenance();
        setInterval(() => backupManager!.runMaintenance(), 24 * 60 * 60 * 1000);
      },
      60 * 60 * 1000,
    );
    state.logger?.info('Backup manager started');
  } catch {
    state.logger?.warn('Backup manager unavailable');
  }

  const a2aClient = new A2AClient(state.logger!);

  state.sessionManager = sessionManager;
  state.metrics = metrics;
  state.backupManager = backupManager;
  state.a2aClient = a2aClient;
}
