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
import type { SessionManager } from '@cabinet/secretary';
import type { AgentRoleRegistry, SkillRegistry } from '@cabinet/agent';
import type { TaskScheduler } from '../scheduler.js';
import type { MCPIntegration } from '../mastra/mcp-integration.js';
import type { DelegationTier } from '@cabinet/types';
import type { getLogger } from '@cabinet/storage';
import type { A2AClient } from '../a2a/a2a-client.js';
import type { EventBus, AgentEventBus, AgentEventRepository } from './event-bus.js';

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
  // Sub-agent interaction
  agentEventRepo: AgentEventRepository;
  agentEventBus: AgentEventBus;
  // Decision service
  decisionService: DecisionService;
  // Session
  sessionManager: SessionManager;
  // File tracking
  fileTracker: import('./trackers.js').FileAccessTracker;
  // Task tracking
  taskTracker: import('./trackers.js').TaskTracker;
  // Permissions
  delegationTier: DelegationTier;
  // Agent registry
  agentRegistry: AgentRoleRegistry;
  // Skill registry
  skillRegistry: SkillRegistry;
  mcpManager: MCPIntegration;
  // Task queues
  taskQueueRepo: AgentTaskQueueRepository;
  daemonRepo: AgentDaemonRepository;
  // Autopilot
  autopilotRepo: AutopilotRepository;
  // Scheduler
  taskScheduler: TaskScheduler;
  // Mastra instance
  mastra?: import('@mastra/core').Mastra;
  // Infrastructure
  eventBus: EventBus;
  metrics: MetricsCollector;
  logger: ReturnType<typeof getLogger>;
  backupManager: BackupManager | null;
  // A2A client
  a2aClient: A2AClient;
  shutdown: () => void;
}

export interface BuildState extends Partial<ServerContext> {
  dataDir: string;
  dbPath: string;
  dbMode: 'file' | 'memory';
}
