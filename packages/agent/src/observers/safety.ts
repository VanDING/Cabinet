import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';
import { SafetyChecker } from '../safety.js';

export class SafetyCheckObserver implements AgentObserver {
  name = 'SafetyCheck';
  private checker: SafetyChecker;

  constructor(checker: SafetyChecker) {
    this.checker = checker;
  }

  async onToolCall(
    call: { id: string; name: string; args: Record<string, unknown> },
    _ctx: AgentExecutionContext,
  ): Promise<{ blocked: boolean; reason?: string }> {
    const safety = this.checker.check(call.name, call.args);
    if (!safety.allowed) {
      return { blocked: true, reason: safety.reason };
    }
    return { blocked: false };
  }
}
