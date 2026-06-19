import { AgentEventRepository, AgentEventBus } from '@cabinet/events';
import { RouteFeedbackRepository, TelemetryRepository } from '@cabinet/storage';
import type { BuildState } from './build-state.js';
import type { ServerContext } from './types.js';
import { broadcast } from '../ws/handler.js';
import { IntentParser } from '@cabinet/secretary';
import { FileAccessTracker, TaskTracker } from './trackers.js';

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
    (parentSessionId, deliverable) => {
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

  // Extend CostTracker to accept external agent reports
  (state.costTracker as any).recordExternal = (entry: {
    model: string;
    promptTokens: number;
    completionTokens: number;
  }) => {
    state.costTracker!.record(entry.model, entry.promptTokens, entry.completionTokens, 0);
  };

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
    gateway: state.gateway!,
    refreshGateway: state.refreshGateway!,
    costTracker: state.costTracker!,
    budgetGuard: state.budgetGuard!,
    sessionManager: state.sessionManager!,
    fileTracker,
    taskTracker,
    delegationTier: state.delegationTier!,
    agentRegistry: state.agentRegistry!,
    skillRegistry: state.skillRegistry!,
    mcpManager: state.mcpManager!,
    taskScheduler: state.taskScheduler!,
    observability: state.observability!,
    autoAdjuster: state.autoAdjuster!,
    skillExtractor: state.skillExtractor!,
    knowledgeGraph: state.knowledgeGraph!,
    memoryDecay: state.memoryDecay!,
    subconsciousLoop: state.subconsciousLoop!,
    eventBus: state.eventBus!,
    metrics: state.metrics!,
    logger: state.logger!,
    backupManager: state.backupManager ?? null,
    daemon: state.daemon!,
    taskQueueRepo: state.taskQueueRepo!,
    daemonRepo: state.daemonRepo!,
    autopilotRepo: state.autopilotRepo!,
    triggerScheduler: state.triggerScheduler ?? null,
    a2aClient: state.a2aClient!,
    blackboard: state.blackboard,
    shutdown: state.shutdown!,
  };

  const parser = new IntentParser(ctx.gateway ?? undefined);
  ctx.intentParser = parser;
  void parser.warmupEmbeddings();

  return ctx;
}
