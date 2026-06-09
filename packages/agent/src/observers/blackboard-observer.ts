import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';
import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';

interface BlackboardUpdate {
  topic: string;
  payload: unknown;
  agentId: string;
}

/**
 * Observes Blackboard writes from other agents and injects them
 * into the current agent's context on the next step boundary.
 */
export class BlackboardObserver implements AgentObserver {
  name = 'BlackboardSync';
  private pendingUpdates: BlackboardUpdate[] = [];
  private handler: ((envelope: any) => void) | null = null;

  constructor(
    private eventBus: EventBus,
    private watchedTopics: string[] = ['discoveries'],
  ) {
    this.handler = (envelope) => {
      const payload = (envelope.payload as unknown as Record<string, unknown> | undefined)?.data;
      if (!payload) return;
      const data = payload as Record<string, unknown>;
      const topic = data?.topic as string | undefined;
      if (topic && this.watchedTopics.includes(topic)) {
        this.pendingUpdates.push({
          topic,
          payload: data.entry ?? data.payload,
          agentId: (data.agentId as string) ?? 'unknown',
        });
      }
    };
    this.eventBus.subscribe(MessageType.SystemNotification, this.handler);
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<void> {
    if (this.pendingUpdates.length === 0) return;
    (ctx as any).pendingBlackboardUpdates = [...this.pendingUpdates];
    this.pendingUpdates = [];
  }

  dispose(): void {
    if (this.handler) {
      this.eventBus.unsubscribe(MessageType.SystemNotification, this.handler);
    }
  }
}
