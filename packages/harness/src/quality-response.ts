import type { EventBus } from '@cabinet/events';
import { MessageType, type DelegationTier } from '@cabinet/types';
import type { AutoAdjuster } from './auto-adjuster.js';

export type ReconsolidationCallback = () => Promise<void>;

export class QualityResponseService {
  private consecutiveAlerts = 0;
  private lastResponseAt = 0;
  private readonly cooldownMs = 30 * 60 * 1000;

  constructor(
    private readonly eventBus: EventBus,
    private readonly autoAdjuster: AutoAdjuster,
    private readonly tier: () => DelegationTier,
    private readonly reconsolidate: ReconsolidationCallback,
  ) {
    this.subscribe();
  }

  private subscribe(): void {
    this.eventBus.subscribe(MessageType.QualityAlert, async (event) => {
      const payload = (event.payload as unknown as Record<string, unknown> | undefined) ?? {};
      await this.handleQualityAlert(payload);
    });
  }

  private async handleQualityAlert(_payload: Record<string, unknown>): Promise<void> {
    if (Date.now() - this.lastResponseAt < this.cooldownMs) return;
    this.lastResponseAt = Date.now();

    this.consecutiveAlerts++;

    if (this.consecutiveAlerts >= 2) {
      await this.autoAdjuster.runHealthCheck(this.tier());
      await this.reconsolidate();
      this.consecutiveAlerts = 0;
    }
  }
}
