import { MessageType } from '@cabinet/types';

interface EventBus {
  publish(msg: {
    messageId: string;
    correlationId: string;
    causationId: string | null;
    timestamp: Date;
    messageType: string;
    payload: unknown;
  }): Promise<void>;
}

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
        type: 'decision_escalation',
        message: `Decision escalated: ${title} (Level: ${level})`,
        data: { decisionId, title, level, urgency: level === 'L3' ? 'immediate' : 'normal' },
      },
    });
  }
}
