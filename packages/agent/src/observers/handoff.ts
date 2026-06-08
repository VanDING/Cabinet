import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';

export class HandoffObserver implements AgentObserver {
  name = 'Handoff';

  async onStepEnd(ctx: AgentExecutionContext): Promise<{ handoff?: boolean }> {
    if (!ctx.handoff || !ctx.lastSnapshot) return {};
    const should = ctx.handoff.shouldHandoff(ctx.lastSnapshot);
    if (!should) return {};

    const result = ctx.handoff.performHandoff(ctx.lastSnapshot);
    ctx.handoffCount++;

    const keepRecent = 4;
    const recentMessages = ctx.messages.slice(-keepRecent);
    const middleMessages = ctx.messages.slice(0, -keepRecent);
    const middleSummary =
      middleMessages.length > 0 ? `${middleMessages.length} prior messages summarized.` : '';

    ctx.messages = [
      { role: 'user', content: result.handoffMessage },
      ...(middleMessages.length > 0
        ? [{ role: 'assistant' as const, content: `[context_compact] ${middleSummary}` }]
        : []),
      ...recentMessages,
    ];
    ctx.handoff.reset();
    ctx.currentStepText = '';
    ctx.currentStepToolCalls = [];

    return { handoff: true };
  }
}
