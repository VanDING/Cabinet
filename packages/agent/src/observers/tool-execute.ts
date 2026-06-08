import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';

export class ToolExecuteObserver implements AgentObserver {
  name = 'ToolExecute';

  async onToolResult(
    call: { id: string; name: string; args: Record<string, unknown> },
    result: unknown,
    ctx: AgentExecutionContext,
  ): Promise<void> {
    const hasError = typeof result === 'string' && result.startsWith('Error');
    if (hasError) {
      ctx.toolCounts.failed++;
      ctx.consecutiveErrors++;
    } else {
      ctx.toolCounts.succeeded++;
      ctx.consecutiveErrors = 0;
    }
    ctx.toolCounts.total++;
    ctx.toolCallHistory.push({ name: call.name, args: call.args, result });
  }
}
