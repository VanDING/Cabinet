import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';

export class EscalationService {
  constructor(private readonly eventBus: EventBus) {}

  async escalate(decisionId: string, title: string, level: string): Promise<void> {
    await this.eventBus.publish({
      messageId: `escalation_${decisionId}_${Date.now()}`,
      correlationId: decisionId,
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.SystemNotification,
      payload: {
        decisionId,
        title,
        level,
        message: `Decision escalated: ${title} (Level: ${level})`,
        urgency: level === 'L3' ? 'immediate' : 'normal',
      },
    });
  }
}
