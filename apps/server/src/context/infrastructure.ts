import { join } from 'node:path';
import { SessionManager } from '@cabinet/secretary';
import { AgentBlackboard } from '@cabinet/agent';
import { MetricsCollector, BackupManager } from '@cabinet/storage';
import { A2AClient } from '../a2a/a2a-client.js';
import type { BuildState } from './build-state.js';

export function initInfrastructure(state: BuildState): void {
  const { db, metricRepo, settingsRepo, eventBus, dataDir, dbPath } = state;
  if (!db || !metricRepo || !settingsRepo || !eventBus || !dataDir || !dbPath) {
    throw new Error('Missing required state for infrastructure');
  }

  const sessionManager = new SessionManager();

  let blackboard: AgentBlackboard | undefined;
  try {
    const blackboardConfig = settingsRepo.get('blackboard_config');
    const bbConfig = blackboardConfig ? JSON.parse(blackboardConfig) : { enabled: false };
    if (bbConfig.enabled !== false) {
      blackboard = new AgentBlackboard(eventBus, bbConfig);
      sessionManager.useBlackboard(blackboard);
      state.logger?.info('Agent Blackboard initialized');
    }
  } catch (e) {
    state.logger?.warn('Blackboard initialization failed', { error: String(e) });
  }

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
  state.blackboard = blackboard;
  state.metrics = metrics;
  state.backupManager = backupManager;
  state.a2aClient = a2aClient;
}
