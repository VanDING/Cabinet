import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';
import { ContextMonitor, type ContextBreakdown } from '../context-monitor.js';

export class ContextMonitorObserver implements AgentObserver {
  name = 'ContextMonitor';
  private monitor: ContextMonitor;

  constructor(monitor: ContextMonitor) {
    this.monitor = monitor;
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<void> {
    const breakdown: ContextBreakdown = {
      systemPrompt: this.monitor.estimateTokens(ctx.systemPrompt),
      messages: this.monitor.estimateTokens(ctx.messages.map((m) => m.content).join('\n')),
      toolResults: this.monitor.estimateTokens(
        ctx.messages
          .filter((m) => m.role === 'user' && m.content.startsWith('Tool result'))
          .map((m) => m.content)
          .join('\n'),
      ),
      memory: 0,
    };
    const snap = this.monitor.snapshot(breakdown);
    ctx.zone = snap.zone;
    ctx.zoneCounts[snap.zone]++;
    ctx.lastSnapshot = snap;
  }
}
