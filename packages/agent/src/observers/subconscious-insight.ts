import type { EventBus } from '@cabinet/events';
import { MessageType, type MessageEnvelope } from '@cabinet/types';
import type { AgentExecutionContext, AgentObserver } from '../observer-pipeline.js';

export interface SubconsciousInsight {
  relevance: number;
  text: string;
  sourceMemoryId: string;
  relatedEntities: string[];
}

/**
 * SubconsciousInsightObserver bridges the harness-layer SubconsciousLoop with
 * AgentLoop. It subscribes to `subconscious_insight` system notifications and
 * injects pending insights into the execution context at stream start.
 */
export class SubconsciousInsightObserver implements AgentObserver {
  name = 'SubconsciousInsight';
  private readonly queue: SubconsciousInsight[] = [];
  private readonly maxInsights: number;
  private readonly handler = (envelope: MessageEnvelope) => this.onEvent(envelope);

  constructor(
    private readonly eventBus: EventBus,
    maxInsights = 3,
  ) {
    this.maxInsights = maxInsights;
    this.eventBus.subscribe(MessageType.SystemNotification, this.handler, this.name);
  }

  private onEvent(envelope: MessageEnvelope): void {
    const payload = envelope.payload as unknown as Record<string, unknown> | undefined;
    if (payload?.type !== 'subconscious_insight') return;
    const insight = payload.insight as SubconsciousInsight | undefined;
    if (!insight) return;
    this.queue.push(insight);
    if (this.queue.length > this.maxInsights) {
      this.queue.shift();
    }
  }

  async onStreamStart(ctx: AgentExecutionContext): Promise<void> {
    if (this.queue.length === 0) return;
    ctx.pendingSubconsciousInsights = [...this.queue];
    this.queue.length = 0;
  }

  async onStreamEnd(_ctx: AgentExecutionContext): Promise<void> {
    // Insights are cleared when attached to context; no further cleanup needed.
  }

  async onStepEnd(_ctx: AgentExecutionContext): Promise<void> {
    // No-op: insights are injected once at stream start.
  }

  /** Expose pending count for tests/debugging. */
  pendingCount(): number {
    return this.queue.length;
  }

  /** Unsubscribe from the event bus. */
  dispose(): void {
    this.eventBus.unsubscribe(MessageType.SystemNotification, this.handler);
  }
}
