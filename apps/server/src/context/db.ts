import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  createConnection,
  runMigrations,
  DecisionRepository,
  DecisionCommentRepository,
  ProjectRepository,
  EventLogRepository,
  WorkflowRepository,
  AuditLogRepository,
  DeliverableRepository,
  ApiKeyRepository,
  AgentRoleRepository,
  SkillRepository,
  EmployeeRepository,
  ProjectContextRepository,
  MetricRepository,
  CostHistoryRepository,
  SessionMetricsRepository,
  SettingsRepository,
  SystemKnowledgeRepository,
  AgentBindingRepository,
  McpServerRepository,
  AgentTaskQueueRepository,
  AgentDaemonRepository,
  AutopilotRepository,
  syncSystemKnowledge,
  SYSTEM_KNOWLEDGE_BASE,
  getLogger,
  ensureCabinetDir,
} from '@cabinet/storage';
import type { Database } from '@cabinet/storage';
import type { BuildState } from './build-state.js';

export function initDatabase(state: BuildState): void {
  const logger = getLogger('server');
  state.logger = logger;

  const dataDir = ensureCabinetDir();
  const dbPath = join(dataDir, 'cabinet.db');
  const dbExists = existsSync(dbPath);
  state.dataDir = dataDir;
  state.dbPath = dbPath;
  state.dbMode = 'file';

  let db: Database;
  try {
    db = createConnection(dbPath);
    runMigrations(db);
    logger.info(`SQLite database initialized (${dbExists ? 'existing' : 'new'})`, { path: dbPath });
    try {
      writeFileSync(
        join(dataDir, 'server-startup.log'),
        `${new Date().toISOString()} | DB: file | path: ${dbPath} | existed: ${dbExists}\n`,
      );
    } catch {
      /* non-fatal */
    }
  } catch (e) {
    logger.error('Failed to initialize file-based SQLite', { error: String(e), path: dbPath });
    try {
      try {
        const existing = readFileSync(join(dataDir, 'server-startup.log'), 'utf-8');
        writeFileSync(
          join(dataDir, 'server-startup.log'),
          existing +
            `${new Date().toISOString()} | DB: FAILED | path: ${dbPath} | error: ${String(e)}\n`,
        );
      } catch {
        writeFileSync(
          join(dataDir, 'server-startup.log'),
          `${new Date().toISOString()} | DB: FAILED | path: ${dbPath} | error: ${String(e)}\n`,
        );
      }
    } catch {
      /* non-fatal */
    }
    try {
      db = createConnection(':memory:');
      runMigrations(db);
      state.dbMode = 'memory';
      logger.warn('Falling back to in-memory database — data will NOT persist across restarts');
    } catch (e2) {
      logger.error('SQLite completely unavailable — running without persistence', {
        error: String(e2),
      });
      db = createConnection(':memory:');
      state.dbMode = 'memory';
    }
  }

  state.db = db;

  state.decisionRepo = new DecisionRepository(db);
  state.decisionCommentRepo = new DecisionCommentRepository(db);
  state.projectRepo = new ProjectRepository(db);
  state.eventRepo = new EventLogRepository(db);
  state.workflowRepo = new WorkflowRepository(db);
  state.auditLogRepo = new AuditLogRepository(db);
  state.deliverableRepo = new DeliverableRepository(db);
  state.apiKeyRepo = new ApiKeyRepository(db);
  state.agentRoleRepo = new AgentRoleRepository(db);
  state.skillRepo = new SkillRepository(db);
  state.employeeRepo = new EmployeeRepository(db);
  state.projectContextRepo = new ProjectContextRepository(db);
  state.metricRepo = new MetricRepository(db);
  state.costHistoryRepo = new CostHistoryRepository(db);
  state.sessionMetricsRepo = new SessionMetricsRepository(db);
  state.settingsRepo = new SettingsRepository(db);
  state.agentBindingRepo = new AgentBindingRepository(db);
  state.mcpServerRepo = new McpServerRepository(db);
  state.taskQueueRepo = new AgentTaskQueueRepository(db);
  state.daemonRepo = new AgentDaemonRepository(db);
  state.autopilotRepo = new AutopilotRepository(db);

  const systemKnowledgeRepo = new SystemKnowledgeRepository(db);
  systemKnowledgeRepo.ensureTable();
  state.systemKnowledgeRepo = systemKnowledgeRepo;
  const syncResult = syncSystemKnowledge(db, SYSTEM_KNOWLEDGE_BASE);
  if (syncResult.updated > 0 || syncResult.created > 0) {
    logger.info('System knowledge synchronized', syncResult);
  }
}
