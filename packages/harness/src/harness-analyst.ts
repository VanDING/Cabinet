import type { LLMGateway } from '@cabinet/gateway';
import type { LongTermMemory } from '@cabinet/memory';
import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';
import type { ObservabilityCollector } from './observability.js';
import type { AutoAdjuster } from './auto-adjuster.js';

export class HarnessAnalyst {
  private lastAnalysisTime: Date = new Date(0);

  constructor(
    private readonly observability: ObservabilityCollector,
    private readonly autoAdjuster: AutoAdjuster,
    private readonly gateway: LLMGateway | null,
    private readonly longTerm: LongTermMemory | null,
    private readonly eventBus?: EventBus,
  ) {}

  async analyze(): Promise<string | null> {
    if (!this.gateway || !this.longTerm) return null;

    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const report = this.observability.generateReport(from, now);
    const health = this.observability.getHealth();
    const actions = this.autoAdjuster.getRecentActions(10);

    // Skip if no data to analyze
    if (report.sessions.total === 0 && actions.length === 0) return null;

    const prompt = this.buildPrompt(report, health, actions);

    try {
      const response = await this.gateway.generateText({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
      });

      const insight = response.content.trim();
      if (!insight) return null;

      await this.longTerm.store({
        content: insight,
        metadata: {
          type: 'harness_insight',
          source: 'HarnessAnalyst',
          period: { from: from.toISOString(), to: now.toISOString() },
          sessions: report.sessions.total,
          toolSuccessRate: report.reliability?.toolSuccessRate ?? 0,
          successRate: report.reliability?.qualityPassRate ?? health.successRate,
        },
        timestamp: now,
      });

      if (this.eventBus) {
        await this.eventBus.publish({
          messageId: `ha_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          correlationId: `ha_${Date.now()}`,
          causationId: null,
          timestamp: new Date(),
          messageType: MessageType.SystemNotification,
          payload: {
            type: 'harness_insight',
            insight: { text: insight, relevance: 0.9, source: 'HarnessAnalyst' },
          } as any,
        });
      }

      this.lastAnalysisTime = now;
      return insight;
    } catch {
      return null;
    }
  }

  private buildPrompt(
    report: ReturnType<ObservabilityCollector['generateReport']>,
    health: ReturnType<ObservabilityCollector['getHealth']>,
    actions: ReturnType<AutoAdjuster['getRecentActions']>,
  ): string {
    const daily = (report.daily ?? []).slice(-7);
    const toolRateTrend = daily.map((d) =>
      `${d.date}: tool pass ${Math.round(d.toolSuccessRate * 100)}%, session success ${Math.round(d.successRate * 100)}%`
    ).join('\n');

    const actionLines = actions.slice(0, 5).map((a) =>
      `- [${a.severity}] ${a.type}: ${a.description} (${a.applied ? 'applied' : 'pending'})`
    ).join('\n');

    return `You are analyzing the Cabinet harness layer health. Summarize in 1-3 concise sentences. Focus on: notable trends, anomalies, or actions that need attention. Write in plain English, no markdown.

Health summary:
- Tool health: ${health.toolHealth}
- Context health: ${health.contextHealth}
- Overall success rate: ${Math.round(health.successRate * 100)}%
- Recent sessions: ${health.recentSessions}

7-day trend:
${toolRateTrend}

Recent auto-adjuster actions:
${actionLines || '(none)'}

Summary:`;
  }
}
