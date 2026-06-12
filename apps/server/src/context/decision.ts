import {
  DecisionService,
  DecisionStateMachine,
  LevelClassifier,
  AuditLogger,
  EscalationService,
  PolicyEngine,
} from '@cabinet/decision';
import { SqliteEventStore } from '@cabinet/events';
import { DEFAULT_CAPTAIN_ID, DEFAULT_CAPTAIN_NAME } from '@cabinet/types';
import type { BuildState } from './build-state.js';
import { getCurrentTier } from './state.js';

export function initDecisionService(state: BuildState): void {
  const { db, decisionRepo, auditLogRepo, eventRepo, workflowRepo, entity } = state;
  if (!db || !decisionRepo || !auditLogRepo || !eventRepo || !workflowRepo || !entity) {
    throw new Error('Missing required state for decision service');
  }

  const stateMachine = new DecisionStateMachine();
  const classifier = new LevelClassifier();
  const auditLog = new AuditLogger(db);
  const eventBus = new SqliteEventStore(eventRepo);
  eventBus.deadLetterQueue.setDb(db);
  const escalation = new EscalationService(eventBus);
  const policyEngine = new PolicyEngine();

  let _triggerCuratorDecisionUpdate:
    | ((
        decisionId: string,
        action: string,
        title: string,
        chosenOptionId: string | undefined,
        captainId: string | undefined,
      ) => void)
    | null = null;
  function triggerCuratorPreferenceUpdate(
    decisionId: string,
    action: string,
    title: string,
    chosenOptionId: string | undefined,
    captainId: string | undefined,
  ): void {
    if (_triggerCuratorDecisionUpdate) {
      _triggerCuratorDecisionUpdate(decisionId, action, title, chosenOptionId, captainId);
    }
  }

  const decisionService = new DecisionService(
    stateMachine,
    classifier,
    auditLog,
    escalation,
    decisionRepo,
    (decisionId, action, title, chosenOptionId, captainId) => {
      try {
        const cid = captainId ?? DEFAULT_CAPTAIN_ID;

        const wfRows = auditLogRepo.findByEntity('workflow_approval', decisionId, { limit: 1 });
        const wfRow = wfRows[0];

        if (wfRow) {
          try {
            const wfData = JSON.parse(wfRow.changes ?? '{}');
            const wfId = wfData.workflowId as string;
            if (wfId) {
              if (action === 'approved' && chosenOptionId === 'approve_continue') {
                workflowRepo.updateStatus(wfId, 'completed');
                auditLogRepo.insert('workflow_approval', decisionId, 'approved', 'system', {
                  ...wfData,
                  status: 'approved',
                  decisionId,
                });
                state.logger?.info('Workflow approved via decision', {
                  workflowId: wfId,
                  decisionId,
                });
              } else {
                workflowRepo.updateStatus(wfId, 'failed');
                auditLogRepo.insert('workflow_approval', decisionId, 'terminated', 'system', {
                  ...wfData,
                  status: 'terminated',
                  decisionId,
                });
                state.logger?.info('Workflow terminated via decision', {
                  workflowId: wfId,
                  decisionId,
                });
              }
            }
          } catch (e: unknown) {
            state.logger?.warn('Workflow resumption failed', {
              error: (e as Error).message,
              decisionId,
            });
          }
        }

        const existing = entity.getPreferences(cid);
        const existingPrefs = existing?.preferences ?? {};
        const history = (existingPrefs.decisionHistory as any[]) ?? [];

        history.push({
          title,
          action,
          chosenOptionId: chosenOptionId ?? null,
          timestamp: new Date().toISOString(),
        });

        const trimmed = history.slice(-50);
        const approvals = trimmed.filter((h: { action: string }) => h.action === 'approved').length;
        const total = trimmed.length;
        const approvalRate = total > 0 ? approvals / total : 0;

        entity.setPreferences(cid, existing?.name ?? DEFAULT_CAPTAIN_NAME, {
          ...existingPrefs,
          decisionHistory: trimmed,
          decisionStats: {
            total,
            approved: approvals,
            rejected: total - approvals,
            approvalRate: Math.round(approvalRate * 100) / 100,
          },
        });

        state.preferenceLearner?.learnFromDecisions(cid).catch((err) => {
          console.warn('Operation failed', err);
        });

        triggerCuratorPreferenceUpdate(decisionId, action, title, chosenOptionId, captainId);
      } catch (e: unknown) {
        state.logger?.warn('Preference learning failed', { error: (e as Error).message });
      }
    },
    getCurrentTier,
    policyEngine,
  );

  state.eventBus = eventBus as any;
  state.decisionService = decisionService;
  (state as any).triggerCuratorPreferenceUpdate = triggerCuratorPreferenceUpdate;
  (state as any).setCuratorDecisionUpdateTrigger = (fn: any) => {
    _triggerCuratorDecisionUpdate = fn;
  };
}
