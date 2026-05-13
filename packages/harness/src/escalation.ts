import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';

export class HarnessEscalation {
  private consecutiveLowQuality = 0;
  private readonly threshold = 3;

  constructor(private readonly eventBus: EventBus) {}

  async reportQuality(quality: number, outputId: string): Promise<void> {
    if (quality < 0.5) {
      this.consecutiveLowQuality++;
    } else {
      this.consecutiveLowQuality = 0;
    }

    if (this.consecutiveLowQuality >= this.threshold) {
      await this.eventBus.publish({
        messageId: `low_quality_${Date.now()}`,
        correlationId: outputId,
        causationId: null,
        timestamp: new Date(),
        messageType: MessageType.SystemNotification,
        payload: {
          message: `Quality alert: ${this.consecutiveLowQuality} consecutive low-quality outputs.`,
          outputId, quality,
        },
      });
    }
  }
}
