// @cabinet/storage - SQLite persistence
export { createConnection, closeConnection, getConnection } from './connection.js';
export type { Database } from 'better-sqlite3';
export { CABINET_DIR, CABINET_SUBDIRS, ensureCabinetDir } from './paths.js';
export { runMigration001 } from './migrations/001_initial.js';
export { runMigration002 } from './migrations/002_projects.js';
export { runMigration003 } from './migrations/003_deliverables.js';
export { EventLogRepository } from './repositories/event-log.js';
export { ProjectRepository } from './repositories/project.js';
export { DecisionRepository } from './repositories/decision.js';
export { BackupManager, type BackupConfig } from './backup.js';
export { Logger, getLogger, type LogLevel, type LogEntry } from './logger.js';
export { MetricsCollector, globalMetrics, type Metric } from './metrics.js';
