import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';
import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';
import { calculatePIS, type ProcessIdentityScore } from '../process-identity-score.js';

export interface PISObserverConfig {
  enabled: boolean;
  mode: 'log_only' | 'intervene';
  evaluationIntervalSteps: number;
}

export class ProcessIdentityObserver implements AgentObserver {
  name = 'ProcessIdentity';
  private originalTask: string;
  private pisHistory: { step: number; score: number }[] = [];
  private config: PISObserverConfig;
  private eventBus?: EventBus;

  constructor(originalTask: string, config?: Partial<PISObserverConfig>, eventBus?: EventBus) {
    this.originalTask = originalTask;
    this.config = {
      enabled: false,
      mode: 'log_only',
      evaluationIntervalSteps: 3,
      ...config,
    };
    this.eventBus = eventBus;
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<void> {
    if (!this.config.enabled) return;

    const interval = this.config.evaluationIntervalSteps;
    if (ctx.stepCount < interval || ctx.stepCount % interval !== 0) return;

    const pis = calculatePIS(ctx, this.originalTask);
    this.pisHistory.push({ step: ctx.stepCount, score: pis.total });
    ctx.pisHistory = this.pisHistory;
    ctx.lastPIS = pis;

    // Log for observability
    if (pis.recommendedAction !== 'continue') {
      console.warn(
        `[PIS] session=${ctx.sessionId} step=${ctx.stepCount} score=${pis.total} trend=${pis.trend} action=${pis.recommendedAction}`,
      );
    }

    // Intervene mode: emit event on handoff/abort recommendation
    if (
      this.config.mode === 'intervene' &&
      this.eventBus &&
      (pis.recommendedAction === 'handoff' || pis.recommendedAction === 'abort')
    ) {
      this.eventBus
        .publish({
          messageId: `pis_alert_${ctx.sessionId}_${ctx.stepCount}`,
          correlationId: ctx.sessionId,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: {
            type: 'process_identity_alert',
            data: {
              sessionId: ctx.sessionId,
              score: pis.total,
              trend: pis.trend,
              action: pis.recommendedAction,
            },
          },
        })
        .catch(() => {});
    }
  }
}
