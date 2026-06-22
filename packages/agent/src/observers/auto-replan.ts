import type { LLMGateway } from '@cabinet/gateway';
import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';

export interface AutoReplanConfig {
  enabled: boolean;
  /** Max consecutive errors before triggering replan (default 2). */
  errorThreshold: number;
  /** Max replan rounds (default 2). */
  maxReplanRounds: number;
  /** Model for error analysis (default haiku). */
  analysisModel?: string;
}

/**
 * AutoReplanObserver — 低层级工具错误自动分析与重规划
 *
 * 在 onToolResult 中检测 ToolResult.error，累计超过阈值后：
 * 1. LLM 分析错误模式
 * 2. 生成调整建议
 * 3. 注入 ctx.messages 并利用 handoff 机制让 Agent 重新决策
 */
export class AutoReplanObserver implements AgentObserver {
  name = 'AutoReplan';
  private errorLog: Array<{ tool: string; error: string; step: number }> = [];
  private replanCount = 0;

  constructor(
    private config: AutoReplanConfig,
    private gateway: LLMGateway,
    private model?: string,
  ) {}

  async onToolResult(
    call: { id: string; name: string; args: Record<string, unknown> },
    result: unknown,
    ctx: AgentExecutionContext,
  ): Promise<void> {
    if (!this.config.enabled) return;

    const hasError =
      (typeof result === 'string' && result.startsWith('Error')) || result instanceof Error;

    if (!hasError) return;

    const errorText = typeof result === 'string' ? result : (result as Error).message;
    this.errorLog.push({ tool: call.name, error: errorText, step: ctx.stepCount });

    const consecutiveErrors = this.countConsecutiveRecentErrors(ctx.stepCount);
    if (consecutiveErrors < this.config.errorThreshold) return;
    if (this.replanCount >= this.config.maxReplanRounds) return;

    this.replanCount++;
    const analysis = await this.analyzeErrors(this.errorLog.slice(-consecutiveErrors));

    ctx.messages.push({
      role: 'user',
      content: `[System: Auto-replan triggered after ${consecutiveErrors} consecutive tool errors.]

Error analysis: ${analysis}

Please revise your approach based on the above analysis.`,
    });

    // 利用 handoff 机制让循环继续（onStepEnd 返回 handoff）
    // 我们在 onStepEnd 中返回 handoff
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<{ handoff?: boolean }> {
    if (!this.config.enabled) return {};

    const consecutiveErrors = this.countConsecutiveRecentErrors(ctx.stepCount);
    if (
      consecutiveErrors >= this.config.errorThreshold &&
      this.replanCount <= this.config.maxReplanRounds
    ) {
      return { handoff: true };
    }
    return {};
  }

  private countConsecutiveRecentErrors(currentStep: number): number {
    let count = 0;
    for (let i = this.errorLog.length - 1; i >= 0; i--) {
      if (this.errorLog[i]!.step >= currentStep - count) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  private async analyzeErrors(errors: Array<{ tool: string; error: string }>): Promise<string> {
    const prompt = `You are an error analyst. Given the following consecutive tool errors, suggest a root cause and a specific adjustment.

Errors:
${errors.map((e, i) => `${i + 1}. Tool: ${e.tool}\n   Error: ${e.error}`).join('\n')}

Respond in 1-2 sentences with concrete advice.`;

    try {
      const result = await this.gateway.generateText({
        model: this.config.analysisModel ?? this.model ?? 'deepseek/deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 200,
        temperature: 0,
      });
      return result.content.trim();
    } catch {
      return 'Unable to analyze errors. Consider simplifying the query or trying different tools.';
    }
  }
}
