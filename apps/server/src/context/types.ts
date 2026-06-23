import type {
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
  RouteFeedbackRepository,
  TelemetryRepository,
  AgentTaskQueueRepository,
  AgentDaemonRepository,
  AutopilotRepository,
  AgentBindingRepository,
  McpServerRepository,
  BackupManager,
  MetricsCollector,
} from '@cabinet/storage';
import type { Database } from '@cabinet/storage';
import type { DecisionService } from '@cabinet/decision';
import type { CostTracker, BudgetGuard, LLMGateway } from '@cabinet/gateway';
import type {
  ShortTermMemory,
  LongTermMemory,
  EntityMemory,
  ProjectMemory,
  MemoryFacade,
  KnowledgeGraph,
  MemoryDecayService,
} from '@cabinet/memory';
import type { SqliteEventStore, AgentEventBus, AgentEventRepository } from '@cabinet/events';
import type { SessionManager } from '@cabinet/secretary';
import type {
  AgentRoleRegistry,
  SkillRegistry,
  AgentBlackboard,
  AgentDaemon,
} from '@cabinet/agent';
import type { TaskScheduler } from '../scheduler.js';
import type { MCPManager } from '../mcp/mcp-manager.js';
import type { ObservabilityCollector, SubconsciousLoop } from '@cabinet/harness';
import type { SkillExtractor } from '@cabinet/agent';
import type { DelegationTier } from '@cabinet/types';
import type { getLogger } from '@cabinet/storage';
import type { EventBus } from '@cabinet/events';
import type { TriggerScheduler } from '@cabinet/agent';
import type { A2AClient } from '../a2a/a2a-client.js';

export type SystemMode = 'normal' | 'maintenance' | 'readonly' | 'emergency';

export interface ServerContext {
  db: Database;
  // Repos
  decisionRepo: DecisionRepository;
  decisionCommentRepo: DecisionCommentRepository;
  projectRepo: ProjectRepository;
  eventRepo: EventLogRepository;
  workflowRepo: WorkflowRepository;
  auditLogRepo: AuditLogRepository;
  deliverableRepo: DeliverableRepository;
  apiKeyRepo: ApiKeyRepository;
  agentRoleRepo: AgentRoleRepository;
  skillRepo: SkillRepository;
  employeeRepo: EmployeeRepository;
  projectContextRepo: ProjectContextRepository;
  metricRepo: MetricRepository;
  costHistoryRepo: CostHistoryRepository;
  sessionMetricsRepo: SessionMetricsRepository;
  settingsRepo: SettingsRepository;
  agentBindingRepo: AgentBindingRepository;
  mcpServerRepo: McpServerRepository;
  systemKnowledgeRepo: SystemKnowledgeRepository;
  routeFeedbackRepo: RouteFeedbackRepository;
  telemetryRepo: TelemetryRepository;
  // Sub-agent interaction
  agentEventRepo: AgentEventRepository;
  agentEventBus: AgentEventBus;
  // Decision service
  decisionService: DecisionService;
  // Memory
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
  entity: EntityMemory;
  project: ProjectMemory;
  memoryFacade: MemoryFacade;
  // Gateway
  gateway: LLMGateway | null;
  refreshGateway: () => void;
  costTracker: CostTracker;
  budgetGuard: BudgetGuard;
  // Session
  sessionManager: SessionManager;
  // Blackboard (4.2)
  blackboard?: AgentBlackboard;
  // File tracking (per-session, auto-populated by tool callbacks)
  fileTracker: import('./trackers.js').FileAccessTracker;
  // Task tracking
  taskTracker: import('./trackers.js').TaskTracker;
  // Permissions
  delegationTier: DelegationTier;
  // Agent registry (shared across all requests — custom roles persist here)
  agentRegistry: AgentRoleRegistry;
  // Skill registry (shared — loaded from DB on startup)
  skillRegistry: SkillRegistry;
  mcpManager: MCPManager;
  // Daemon (pull-mode agent task queue + runtime)
  daemon: AgentDaemon;
  taskQueueRepo: AgentTaskQueueRepository;
  daemonRepo: AgentDaemonRepository;
  // Autopilot (cron/webhook/manual triggers)
  autopilotRepo: AutopilotRepository;
  triggerScheduler: TriggerScheduler | null;
  // Scheduler
  taskScheduler: TaskScheduler;
  // Feedback loop
  observability: ObservabilityCollector;
  // Skill extraction
  skillExtractor: SkillExtractor;
  // Knowledge graph
  knowledgeGraph: KnowledgeGraph;
  // Memory decay
  memoryDecay: MemoryDecayService;
  // Subconscious loop
  subconsciousLoop: SubconsciousLoop;
  // Intent parser (pre-created for fast routing)
  intentParser?: import('@cabinet/secretary').IntentParser;
  // Mastra instance (SDK v7 integration)
  mastra?: import('@mastra/core').Mastra;
  // Infrastructure
  eventBus: EventBus;
  metrics: MetricsCollector;
  logger: ReturnType<typeof getLogger>;
  backupManager: BackupManager | null;
  // A2A client
  a2aClient: A2AClient;
  /** Clean up all timers, close DB, stop backup. Call on process exit. */
  shutdown: () => void;
}
