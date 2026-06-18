// @cabinet/storage - SQLite persistence
export { createConnection, closeConnection, getConnection } from './connection.js';
export type { Database } from 'better-sqlite3';
export { CABINET_DIR, CABINET_SUBDIRS, ensureCabinetDir } from './paths.js';
export { runMigration001, trackMigration } from './migrations/001_initial.js';
export { runMigration002 } from './migrations/002_projects.js';
export { runMigration003 } from './migrations/003_deliverables.js';
export { runMigration004 } from './migrations/004_scheduled_tasks.js';
export { runMigration005 } from './migrations/005_workflow_runs.js';
export { runMigration006 } from './migrations/006_document_chunks.js';
export { runMigration007 } from './migrations/007_evaluation_results.js';
export { runMigration008 } from './migrations/008_skill_metadata.js';
export { runMigration009 } from './migrations/009_checkpoints.js';
export { runMigration010 } from './migrations/010_runtime_tables.js';
export { runMigration011 } from './migrations/011_memory_metadata_index.js';
export { runMigration015 } from './migrations/015_memory_graph.js';
export { runMigration019 } from './migrations/019_project_name_unique.js';
export { runMigration024 } from './migrations/024_external_agent.js';
export { runMigration025 } from './migrations/025_agent_daemon.js';
export { runMigration026 } from './migrations/026_autopilot_triggers.js';
export { runMigration027 } from './migrations/027_agent_squads.js';
export { runMigration030 } from './migrations/030_task_kanban_fields.js';
export { SquadRepository, type SquadRow, type SquadMemberRow } from './repositories/squad-repo.js';
export {
  AutopilotRepository,
  type AutopilotTriggerRow,
  type AutopilotRunRow,
} from './repositories/autopilot-repo.js';
export { runMigrations, MIGRATIONS, type MigrationEntry } from './migrations/runner.js';
// Repositories
export { EventLogRepository } from './repositories/event-log.js';
export { ProjectRepository } from './repositories/project.js';
export { DecisionRepository } from './repositories/decision.js';
export {
  DecisionCommentRepository,
  type DecisionCommentRow,
} from './repositories/decision-comment-repo.js';
export {
  WorkflowRepository,
  type WorkflowRow,
  type WorkflowRunRow,
} from './repositories/workflow-repo.js';
export { AuditLogRepository, type AuditLogRow } from './repositories/audit-log-repo.js';
export { ApiKeyRepository, type ApiKeyRow } from './repositories/api-key-repo.js';
export { AgentRoleRepository, type AgentRoleRow } from './repositories/agent-role-repo.js';
export { SkillRepository, type SkillRow } from './repositories/skill-repo.js';
export { EmployeeRepository, type EmployeeRow } from './repositories/employee-repo.js';
export {
  ProjectContextRepository,
  type ProjectContextRow,
} from './repositories/project-context-repo.js';
export { SettingsRepository } from './repositories/settings-repo.js';
export { MetricRepository, type MetricRow } from './repositories/metric-repo.js';
export {
  ScheduledTaskRepository,
  type ScheduledTaskRow,
} from './repositories/scheduled-task-repo.js';
export { CostHistoryRepository, type CostHistoryRow } from './repositories/cost-history-repo.js';
export {
  SessionMetricsRepository,
  type SessionMetricRow,
} from './repositories/session-metrics-repo.js';
export {
  DocumentChunkRepository,
  type DocumentChunkRow,
} from './repositories/document-chunk-repo.js';
export { DeliverableRepository, type DeliverableRow } from './repositories/deliverable-repo.js';
export {
  EvaluationResultRepository,
  type EvaluationResultRow,
} from './repositories/evaluation-result-repo.js';
export {
  ShortTermMemoryRepository,
  type ShortTermMemoryRow,
} from './repositories/short-term-memory-repo.js';
export {
  LongTermMemoryRepository,
  type LongTermMemoryRow,
} from './repositories/long-term-memory-repo.js';
export {
  EntityMemoryRepository,
  type EntityPrefsRow,
  type EntityEmployeeRow,
} from './repositories/entity-memory-repo.js';
export { CheckpointRepository } from './repositories/checkpoint-repo.js';
export { SystemKnowledgeRepository } from './repositories/system-knowledge-repo.js';
export {
  RouteFeedbackRepository,
  type RouteFeedbackRow,
} from './repositories/route-feedback-repo.js';
export { TelemetryRepository, type TelemetryRow } from './repositories/telemetry-repo.js';
export {
  AgentTaskQueueRepository,
  type TaskQueueRow,
} from './repositories/agent-task-queue-repo.js';
export {
  AgentDaemonRepository,
  type HeartbeatRow,
  type WorkspaceRow,
} from './repositories/agent-daemon-repo.js';
export {
  SYSTEM_KNOWLEDGE_BASE,
  syncSystemKnowledge,
  type SystemKnowledgeBaseEntry,
} from './system-knowledge-base.js';
// Utilities
export { BackupManager, type BackupConfig, type BackupResult } from './backup.js';
export { Logger, getLogger, type LogLevel, type LogEntry } from './logger.js';
export { MetricsCollector, globalMetrics, type Metric } from './metrics.js';
