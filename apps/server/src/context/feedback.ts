import { MessageType } from '@cabinet/types';
import {
  ObservabilityCollector,
  PreferenceLearner,
  AutoAdjuster,
  QualityResponseService,
  HarnessAnalyst,
} from '@cabinet/harness';
import { SkillExtractor } from '@cabinet/agent';
import type {
  PreferenceAnalysisCallback,
  AdjustmentNotifyCallback,
  ReconsolidationCallback,
} from '@cabinet/harness';
import type { BuildState } from './build-state.js';
import { getCurrentTier } from './state.js';

export function initFeedbackLoop(state: BuildState): void {
  const { db, eventBus, entity, gateway, agentRegistry, longTerm, shortTerm } = state;
  if (!db || !eventBus || !entity || !agentRegistry || !longTerm || !shortTerm) {
    throw new Error('Missing required state for feedback loop');
  }

  const observability = new ObservabilityCollector(eventBus);

  const preferenceAnalysisCallback: PreferenceAnalysisCallback = async (
    captainId,
    decisionHistory,
    existingPreferences,
  ) => {
    if (!gateway) return PreferenceLearner.defaultProfile();
    try {
      const response = await gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [
          {
            role: 'user',
            content: [
              "Analyze this decision history and extract the Captain's preferences.",
              `Captain: ${captainId}`,
              `Decisions: ${JSON.stringify(decisionHistory.slice(-20))}`,
              `Existing preferences: ${JSON.stringify(existingPreferences)}`,
              'Respond with ONLY a JSON object:',
              '{',
              '  "riskTolerance": "low"|"medium"|"high",',
              '  "costSensitivity": "low"|"medium"|"high",',
              '  "timeUrgency": "relaxed"|"moderate"|"urgent",',
              '  "preferredDecisionStyle": "consensus"|"directive"|"analytical",',
              '  "commonRejectionReasons": ["reason1"],',
              '  "domainPreferences": {"domain": "preference"},',
              '  "confidence": 0.8',
              '}',
            ].join('\n'),
          },
        ],
        maxTokens: 300,
        temperature: 0.2,
      });
      const match = response.content.match(/\{[\s\S]*\}/);
      if (!match) return PreferenceLearner.defaultProfile();
      return { ...PreferenceLearner.defaultProfile(), ...JSON.parse(match[0]) };
    } catch {
      return PreferenceLearner.defaultProfile();
    }
  };

  const preferenceLearner = new PreferenceLearner(entity, preferenceAnalysisCallback);

  const adjustmentNotifyCallback: AdjustmentNotifyCallback = async (action) => {
    const policyCheck = (state as any).policyEngine?.evaluateAdjustment(action);
    if (!policyCheck) {
      state.logger?.info('Adjustment blocked by PolicyEngine', {
        type: action.type,
        reason: 'Violates mission constraints',
      });
      await eventBus.publish({
        messageId: `adj_blocked_${Date.now()}`,
        correlationId: `adj_${Date.now()}`,
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SystemNotification,
        payload: {
          type: 'adjustment_blocked',
          data: { ...action, blockedReason: 'PolicyEngine rejected this adjustment' },
        },
      });
      return false;
    }

    const effectiveAction = policyCheck !== action ? policyCheck : action;
    state.logger?.info(
      'Adjustment requiring Captain approval',
      effectiveAction as Record<string, unknown>,
    );
    await eventBus.publish({
      messageId: `adj_notify_${Date.now()}`,
      correlationId: `adj_${Date.now()}`,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: {
        type: 'adjustment_pending',
        data: effectiveAction as Record<string, unknown>,
      },
    });
    return true;
  };

  const autoAdjuster = new AutoAdjuster(
    observability,
    agentRegistry,
    eventBus,
    (tier: string, model: string) => {
      state.setModelMapping?.({ ...state.modelMapping, [tier]: model });
      if (state.gateway && (state.gateway as any).setModelMapping) {
        (state.gateway as any).setModelMapping(state.modelMapping);
      }
    },
    adjustmentNotifyCallback,
    (state as any).policyEngine,
  );
  autoAdjuster.startListening();

  const harnessAnalyst = new HarnessAnalyst(
    observability,
    autoAdjuster,
    gateway ?? null,
    longTerm,
    eventBus,
  );

  const reconsolidationCallback: ReconsolidationCallback = async () => {
    if (!gateway) return;
    try {
      for (const sid of shortTerm.getAllSessionIds()) {
        await state.consolidation!.consolidateBasic(sid);
      }
      state.logger?.info('Re-consolidation triggered by quality alert');
    } catch (e: unknown) {
      state.logger?.warn('Re-consolidation failed', { error: (e as Error).message });
    }
  };

  const qualityResponse = new QualityResponseService(
    eventBus,
    autoAdjuster,
    () => getCurrentTier(),
    reconsolidationCallback,
  );

  state.observability = observability;
  state.preferenceLearner = preferenceLearner;
  state.autoAdjuster = autoAdjuster;
  state.harnessAnalyst = harnessAnalyst;
  state.qualityResponse = qualityResponse;
  state.skillExtractor = new SkillExtractor(gateway ?? null);
}
