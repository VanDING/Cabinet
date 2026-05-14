import Database from 'better-sqlite3';
import { runMigration001, DecisionRepository, OrganizationRepository, ProjectRepository, EventLogRepository, MetricsCollector, BackupManager, getLogger } from '@cabinet/storage';
import { DecisionService, DecisionStateMachine, LevelClassifier, AuditLogger, EscalationService } from '@cabinet/decision';
import { AISDKAdapter, CostTracker, BudgetGuard } from '@cabinet/gateway';
import { ShortTermMemory, LongTermMemory, EntityMemory, ProjectMemory } from '@cabinet/memory';
import { MemoryEventBus } from '@cabinet/events';
import { SessionManager } from '@cabinet/secretary';
import { config } from './config.js';
import type { LLMGateway } from '@cabinet/gateway';

export interface ServerContext {
  db: Database.Database;
  // Repos
  decisionRepo: DecisionRepository;
  orgRepo: OrganizationRepository;
  projectRepo: ProjectRepository;
  eventRepo: EventLogRepository;
  // Decision service
  decisionService: DecisionService;
  // Memory
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
  // Gateway
  gateway: LLMGateway | null;
  costTracker: CostTracker;
  budgetGuard: BudgetGuard;
  // Session
  sessionManager: SessionManager;
  // Infrastructure
  eventBus: MemoryEventBus;
  metrics: MetricsCollector;
  logger: ReturnType<typeof getLogger>;
  backupManager: BackupManager | null;
}

let ctx: ServerContext | null = null;

export function getServerContext(): ServerContext {
  if (ctx) return ctx;

  const logger = getLogger('server');

  // Database
  let db: Database.Database;
  try {
    db = new Database('cabinet.db');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigration001(db);
    logger.info('SQLite database initialized', { path: 'cabinet.db' });
  } catch (e) {
    logger.error('Failed to initialize SQLite', { error: String(e) });
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigration001(db);
    logger.warn('Falling back to in-memory database');
  }

  // Repositories
  const decisionRepo = new DecisionRepository(db);
  const orgRepo = new OrganizationRepository(db);
  const projectRepo = new ProjectRepository(db);
  const eventRepo = new EventLogRepository(db);

  // Decision service
  const stateMachine = new DecisionStateMachine();
  const classifier = new LevelClassifier();
  const auditLog = new AuditLogger(db);
  const eventBus = new MemoryEventBus();
  const escalation = new EscalationService(eventBus);
  const decisionService = new DecisionService(stateMachine, classifier, auditLog, escalation, decisionRepo);

  // Memory (shared DB for long-term)
  const shortTerm = new ShortTermMemory();
  const longTerm = new LongTermMemory(db);
  const entity = new EntityMemory();
  const project = new ProjectMemory();

  // Gateway + Cost
  const costTracker = new CostTracker();
  const budgetGuard = new BudgetGuard(costTracker);
  let gateway: LLMGateway | null = null;
  if (config.anthropicApiKey || config.openaiApiKey) {
    gateway = new AISDKAdapter({
      anthropic: config.anthropicApiKey ? { apiKey: config.anthropicApiKey } : undefined,
      openai: config.openaiApiKey ? { apiKey: config.openaiApiKey } : undefined,
    });
    logger.info('LLM Gateway initialized');
  } else {
    logger.warn('No API keys configured — LLM features unavailable');
  }

  // Session
  const sessionManager = new SessionManager();

  // Metrics
  const metrics = new MetricsCollector();

  // Backup (if file DB)
  let backupManager: BackupManager | null = null;
  try {
    backupManager = new BackupManager({
      dbPath: 'cabinet.db',
      backupDir: './backups',
      intervalMinutes: 60,
      keepCount: 7,
    });
    backupManager.startAutoBackup();
    logger.info('Backup manager started');
  } catch {
    logger.warn('Backup manager unavailable');
  }

  ctx = {
    db, decisionRepo, orgRepo, projectRepo, eventRepo,
    decisionService,
    shortTerm, longTerm, entity, project,
    gateway, costTracker, budgetGuard,
    sessionManager,
    eventBus, metrics, logger, backupManager,
  };

  return ctx;
}
