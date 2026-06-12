import { join } from 'node:path';
import { broadcast } from '../ws/handler.js';
import { getBrowserPool } from '../capabilities.js';
import {
  startSkillWatcher,
  startAgentWatcher,
  startProjectWatcher,
  startRulesWatcher,
  startBlueprintWatcher,
} from '../watchers.js';
import { MessageType, DAILY_BUDGET } from '@cabinet/types';
import { CliAdapter } from '@cabinet/agent';
import { startApprovalPolling, stopApprovalPolling } from '../routes/workflows.js';
import type { BuildState } from './build-state.js';

export interface Timers {
  consolidationTimer: ReturnType<typeof setInterval>;
  observabilityTimer: ReturnType<typeof setInterval>;
  autoAdjustTimer: ReturnType<typeof setInterval>;
  sessionCleanupTimer: ReturnType<typeof setInterval>;
  browserPoolCleanupTimer: ReturnType<typeof setInterval>;
  externalAgentDetectTimer: ReturnType<typeof setInterval>;
  memoryMaintenanceTimer: ReturnType<typeof setInterval>;
}

export function initTimersAndWatchers(state: BuildState): Timers {
  const {
    dataDir,
    db,
    shortTerm,
    longTerm,
    eventBus,
    agentRegistry,
    skillRegistry,
    skillRepo,
    agentRoleRepo,
    logger: loggerRaw,
    metrics,
    metricRepo,
    sessionMetricsRepo,
    sessionManager,
    consolidation,
    observability,
    autoAdjuster,
    costTracker,
    budgetGuard,
    curatorSubsystem,
    curatorTimers,
    memoryDecay,
    backupManager,
    daemonContext,
    triggerScheduler,
    taskScheduler,
    workflowRepo,
  } = state;

  if (
    !dataDir ||
    !db ||
    !shortTerm ||
    !longTerm ||
    !eventBus ||
    !agentRegistry ||
    !metrics ||
    !metricRepo ||
    !sessionMetricsRepo ||
    !sessionManager ||
    !consolidation ||
    !observability ||
    !autoAdjuster ||
    !costTracker ||
    !budgetGuard ||
    !memoryDecay ||
    !taskScheduler ||
    !workflowRepo
  ) {
    throw new Error('Missing required state for timers/watchers');
  }

  const logger = loggerRaw!;

  const consolidationTimer = setInterval(
    async () => {
      try {
        for (const sid of shortTerm.getAllSessionIds()) {
          await consolidation.consolidateBasic(sid);
        }
      } catch (e: unknown) {
        logger.warn('Basic consolidation failed', { error: (e as Error).message });
        broadcast('background_error', { task: 'consolidation', error: (e as Error).message });
      }
    },
    30 * 60 * 1000,
  );
  consolidationTimer.unref();
  logger.info('Basic memory consolidation scheduled (30min)');

  const observabilityTimer = setInterval(
    () => {
      try {
        const now = new Date();
        const summary = metrics.getSummary();
        metricRepo.insert('observability_snapshot', JSON.stringify(summary), {
          date: now.toISOString().slice(0, 10),
          type: 'daily',
        });

        const { sessions } = observability.export();
        for (const s of sessions) {
          const totalTokens = (s.totalTokens?.prompt ?? 0) + (s.totalTokens?.completion ?? 0);
          const durationMs =
            s.startTime && s.endTime
              ? new Date(s.endTime).getTime() - new Date(s.startTime).getTime()
              : 0;
          const success = s.errors ? (s.errors.fatal === 0 ? 1 : 0) : 1;
          const errorType =
            s.errors && s.errors.fatal > 0
              ? 'fatal'
              : s.errors && s.errors.recoverable > 0
                ? 'recoverable'
                : null;
          sessionMetricsRepo.upsert({
            session_id: s.sessionId,
            project_id: s.projectId ?? null,
            role: s.role ?? null,
            model: s.model ?? null,
            total_steps: s.totalSteps,
            total_tokens: totalTokens,
            total_cost: s.totalCost,
            tool_calls_total: s.toolCalls?.total ?? 0,
            tool_calls_failed: s.toolCalls?.failed ?? 0,
            tool_calls_blocked: s.toolCalls?.blocked ?? 0,
            duration_ms: durationMs,
            success,
            error_type: errorType,
            started_at: s.startTime,
            ended_at: s.endTime ?? now.toISOString(),
          });
        }
        sessionMetricsRepo.pruneOlderThan(30);
      } catch (e: unknown) {
        logger.warn('Observability persistence failed', { error: (e as Error).message });
        broadcast('background_error', { task: 'observability', error: (e as Error).message });
      }
    },
    30 * 60 * 1000,
  );
  observabilityTimer.unref();
  logger.info('Observability persistence scheduled (30 min)');

  const autoAdjustTimer = setInterval(
    async () => {
      try {
        await autoAdjuster.runHealthCheck(state.delegationTier!);
      } catch (e: unknown) {
        logger.warn('Auto-adjustment health check failed', { error: (e as Error).message });
        broadcast('background_error', { task: 'auto_adjust', error: (e as Error).message });
      }

      try {
        const budget = budgetGuard.canProceed();
        if (!budget.allowed && eventBus) {
          const todayCost = costTracker.getDailyCost();
          await eventBus.publish({
            messageId: `budget_alert_${Date.now()}`,
            correlationId: `budget_alert_${Date.now()}`,
            causationId: null,
            timestamp: new Date(),
            messageType: MessageType.BudgetAlert,
            payload: {
              level: 'critical' as const,
              currentSpend: todayCost,
              limit: DAILY_BUDGET,
              period: 'daily' as const,
            },
          });
          broadcast('budget_alert', {
            reason: budget.reason ?? 'Budget limit exceeded',
            currentCost: todayCost,
          });
          logger.warn('BudgetAlert published', { todayCost, reason: budget.reason });
        }
      } catch (e: unknown) {
        logger.warn('Budget check failed', { error: (e as Error).message });
        broadcast('background_error', { task: 'budget_check', error: (e as Error).message });
      }
    },
    60 * 60 * 1000,
  );
  autoAdjustTimer.unref();
  logger.info('Auto-adjustment health check + budget enforcement scheduled (1h)');

  const sessionCleanupTimer = setInterval(
    () => {
      try {
        const cleaned = sessionManager.cleanExpiredSessions();
        if (cleaned > 0) {
          logger.info('Session cleanup completed', { cleaned });
        }
      } catch (e: unknown) {
        logger.warn('Session cleanup failed', { error: (e as Error).message });
      }
    },
    6 * 60 * 60 * 1000,
  );
  sessionCleanupTimer.unref();
  logger.info('Session cleanup scheduled (6h)');

  const browserPoolCleanupTimer = setInterval(
    () => {
      getBrowserPool()
        .pruneIdleSessions(10 * 60 * 1000)
        .catch(() => {});
    },
    10 * 60 * 1000,
  );
  browserPoolCleanupTimer.unref?.();
  logger.info('BrowserPool idle cleanup scheduled (10min)');

  const externalAgentDetectTimer = setInterval(async () => {
    try {
      for (const role of agentRegistry.list()) {
        if (role.type === 'external_cli' && role.external) {
          const adapter = new CliAdapter(role.name, {
            command: role.external.command ?? role.name,
            args: role.external.args ?? [],
            env: role.external.env,
            detectCommand: role.external.detectCommand,
          });
          const online = await adapter.detect().catch(() => false);
          broadcast('agent_status_change', {
            agentId: role.name,
            status: online ? 'online' : 'offline',
          });
        }
        if (role.type === 'external_a2a' && role.external?.baseUrl) {
          try {
            const resp = await fetch(`${role.external.baseUrl}/health`, {
              signal: AbortSignal.timeout(5000),
            });
            broadcast('agent_status_change', {
              agentId: role.name,
              status: resp.ok ? 'online' : 'offline',
            });
          } catch {
            broadcast('agent_status_change', { agentId: role.name, status: 'offline' });
          }
        }
      }
    } catch {
      /* best-effort detection */
    }
  }, 60_000);
  externalAgentDetectTimer.unref?.();
  logger.info('External agent detection scheduled (60s)');

  const memoryMaintenanceTimer = setInterval(async () => {
    try {
      const result = await memoryDecay.runDecayCycle();
      if (result.expired > 0 || result.archived > 0) {
        logger.info('Memory decay cycle completed', {
          expired: result.expired,
          archived: result.archived,
          superseded: result.superseded,
        });
      }
    } catch (err) {
      logger.error('Memory decay cycle failed', { error: (err as Error).message });
    }
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() === 3 && now.getMinutes() < 5) {
      try {
        logger.info('Starting weekly long-term memory index rebuild');
        await longTerm.rebuildIndex();
        logger.info('Weekly long-term memory index rebuild completed');
      } catch (err) {
        logger.error('Weekly index rebuild failed', { error: (err as Error).message });
      }
    }
  }, 3600000);
  state.memoryMaintenanceTimer = memoryMaintenanceTimer;

  // Curator timers were already started by initCuratorSubsystem; just reference them for shutdown.

  startApprovalPolling(30_000);
  logger.info('Workflow approval polling started (30s)');

  if (skillRegistry && skillRepo && agentRegistry && agentRoleRepo) {
    startSkillWatcher(dataDir, { skillRegistry, skillRepo, agentRegistry, agentRoleRepo, logger });
    startAgentWatcher(dataDir, { skillRegistry, skillRepo, agentRegistry, agentRoleRepo, logger });
  }
  startProjectWatcher(dataDir, { logger });
  startRulesWatcher(dataDir, {
    reloadRules: () => {
      broadcast('rules_changed', { dir: join(dataDir, 'rules') });
    },
    logger,
  });
  startBlueprintWatcher(dataDir, {
    logger,
    onBlueprintChange: async (filePath, content) => {
      try {
        if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
          const { parseYamlBlueprint } = await import('@cabinet/workflow');
          const importDynamic = new Function('modulePath', 'return import(modulePath)');
          const yaml = await importDynamic('yaml');
          const parsed = yaml.parse(content);
          const result = parseYamlBlueprint(parsed);
          if (!result.ok) return result.errors?.join('; ') ?? 'YAML parse failed';
        } else {
          return 'Unsupported blueprint format (expected .yaml or .yml)';
        }
        return null;
      } catch (err) {
        return String(err);
      }
    },
  });

  state.shutdown = () => {
    logger.info('Shutting down server context...');
    clearInterval(consolidationTimer);
    clearInterval(observabilityTimer);
    if (curatorTimers) {
      clearInterval(curatorTimers.curatorNudge);
      clearInterval(curatorTimers.curatorPattern);
      clearInterval(curatorTimers.subconscious);
      clearInterval(curatorTimers.harnessAnalyst);
    }
    clearInterval(autoAdjustTimer);
    clearInterval(sessionCleanupTimer);
    clearInterval(memoryMaintenanceTimer);
    clearInterval(browserPoolCleanupTimer);
    stopApprovalPolling();
    taskScheduler.stop();
    try {
      getBrowserPool()
        .shutdown()
        .catch(() => {});
    } catch {
      /* BrowserPool may not be initialized */
    }
    try {
      backupManager?.stopAutoBackup();
    } catch {
      /* backup manager may already be stopped */
    }
    try {
      daemonContext?.shutdown().catch(() => {});
    } catch {
      /* daemon may already be stopped */
    }
    try {
      triggerScheduler?.stop();
    } catch {
      /* scheduler may already be stopped */
    }
    try {
      db.close();
    } catch {
      /* db may already be closed */
    }
    logger.info('Server context shut down');
  };

  return {
    consolidationTimer,
    observabilityTimer,
    autoAdjustTimer,
    sessionCleanupTimer,
    browserPoolCleanupTimer,
    externalAgentDetectTimer,
    memoryMaintenanceTimer,
  };
}
