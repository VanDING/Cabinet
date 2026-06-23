import { RouteFeedbackRepository, TelemetryRepository } from '@cabinet/storage';
import type { BuildState } from './types.js';
import type { ServerContext } from './types.js';
import { broadcast } from '../ws/handler.js';
import { IntentParser } from '@cabinet/secretary';
import { FileAccessTracker, TaskTracker } from './trackers.js';
import { AgentEventRepository, AgentEventBus } from './event-bus.js';

export function assembleContext(state: BuildState): ServerContext {
  const { db } = state;
  if (!db) {
    throw new Error('Database not initialized');
  }

  const routeFeedbackRepo = new RouteFeedbackRepository(db);
  const telemetryRepo = new TelemetryRepository(db);
  const agentEventRepo = new AgentEventRepository(db);
  const agentEventBus = new AgentEventBus(
    broadcast,
    agentEventRepo,
    (parentSessionId: string, deliverable: unknown) => {
      try {
        const deliverableText =
          typeof deliverable === 'string' ? deliverable : JSON.stringify(deliverable);
        state.sessionManager!.addMessage(
          parentSessionId,
          'assistant',
          `[Sub-agent completed]\n${deliverableText}`,
        );
      } catch {
        /* parent session may be closed */
      }
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
    telemetryRepo,
    agentEventRepo,
    agentEventBus,
    decisionService: state.decisionService!,
    shortTerm: state.shortTerm!,
    longTerm: state.longTerm!,
    entity: state.entity!,
    project: state.project!,
    memoryFacade: state.memoryFacade!,
    sessionManager: state.sessionManager!,
    fileTracker,
    taskTracker,
    delegationTier: state.delegationTier!,
    agentRegistry: state.agentRegistry!,
    skillRegistry: state.skillRegistry!,
    mcpManager: state.mcpManager!,
    taskScheduler: state.taskScheduler!,
    knowledgeGraph: state.knowledgeGraph!,
    memoryDecay: state.memoryDecay!,
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

  const parser = new IntentParser();
  ctx.intentParser = parser;
  void parser.warmupEmbeddings();

  return ctx;
}
