import { RouteFeedbackRepository } from '@cabinet/storage';
import type { BuildState } from './types.js';
import type { ServerContext } from './types.js';
import { broadcast } from '../ws/handler.js';
import { FileAccessTracker, TaskTracker } from './trackers.js';
import { AgentEventRepository, AgentEventBus } from './event-bus.js';

export function assembleContext(state: BuildState): ServerContext {
  const { db } = state;
  if (!db) {
    throw new Error('Database not initialized');
  }

  const routeFeedbackRepo = new RouteFeedbackRepository(db);
  const agentEventRepo = new AgentEventRepository(db);
  const agentEventBus = new AgentEventBus(
    broadcast,
    agentEventRepo,
    (_parentSessionId: string, _deliverable: unknown) => {
      /* messages stored by Mastra memory — no-op for sub-agent completion */
    },
  );

  const fileTracker = new FileAccessTracker();
  const taskTracker = new TaskTracker();

  const ctx: ServerContext = {
    db,
    decisionRepo: state.decisionRepo!,
    decisionCommentRepo: state.decisionCommentRepo!,
    projectRepo: state.projectRepo!,
    eventRepo: state.eventRepo!,
    workflowRepo: state.workflowRepo!,
    auditLogRepo: state.auditLogRepo!,
    deliverableRepo: state.deliverableRepo!,
    apiKeyRepo: state.apiKeyRepo!,
    agentRoleRepo: state.agentRoleRepo!,
    skillRepo: state.skillRepo!,
    employeeRepo: state.employeeRepo!,
    projectContextRepo: state.projectContextRepo!,
    metricRepo: state.metricRepo!,
    costHistoryRepo: state.costHistoryRepo!,
    sessionMetricsRepo: state.sessionMetricsRepo!,
    settingsRepo: state.settingsRepo!,
    systemKnowledgeRepo: state.systemKnowledgeRepo!,
    routeFeedbackRepo,
    agentEventRepo,
    agentEventBus,
    decisionService: state.decisionService!,
    sessionManager: state.sessionManager!,
    fileTracker,
    taskTracker,
    delegationTier: state.delegationTier!,
    agentRegistry: state.agentRegistry!,
    skillRegistry: state.skillRegistry!,
    mcpManager: state.mcpManager!,
    taskScheduler: state.taskScheduler!,
    eventBus: state.eventBus!,
    metrics: state.metrics!,
    logger: state.logger!,
    backupManager: state.backupManager ?? null,
    taskQueueRepo: state.taskQueueRepo!,
    daemonRepo: state.daemonRepo!,
    autopilotRepo: state.autopilotRepo!,
    a2aClient: state.a2aClient!,
    agentBindingRepo: state.agentBindingRepo!,
    mcpServerRepo: state.mcpServerRepo!,
    shutdown: state.shutdown!,
  };

  return ctx;
}
