import type { LLMGateway } from '@cabinet/gateway';
import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';

export interface ReflectionConfig {
  enabled: boolean;
  maxRounds: number;
  critiqueModel?: string;
  qualityThreshold: number;
  critiquePrompt?: string;
}

/**
 * ReflectionObserver — 最终输出自动 critique→revise
 *
 * 在 onStepEnd 中工作：如果当前步骤是 final answer 且质量不够，
 * 注入 critique 到 ctx.messages 并返回 { handoff: true }，让循环继续。
 */
export class ReflectionObserver implements AgentObserver {
  name = 'Reflection';
  private roundCounts = new Map<string, number>();

  constructor(
    private config: ReflectionConfig,
    private gateway: LLMGateway,
  ) {}

  async onStepEnd(ctx: AgentExecutionContext): Promise<{ handoff?: boolean }> {
    if (!this.config.enabled) return {};

    // 只处理 final answer 步骤
    const isFinalAnswer = ctx.currentStepToolCalls.length === 0 && ctx.finalContent.length > 0;
    if (!isFinalAnswer) return {};

    const currentRound = this.roundCounts.get(ctx.sessionId) ?? 0;
    if (currentRound >= this.config.maxRounds) {
      this.roundCounts.delete(ctx.sessionId);
      return {};
    }

    const score = await this.critique(ctx.finalContent, ctx.messages);
    if (score >= this.config.qualityThreshold) {
      this.roundCounts.delete(ctx.sessionId);
      return {};
    }

    // 质量不够：注入 critique 并触发 handoff
    const critiqueMessage = this.buildCritiqueMessage(score, ctx.finalContent);
    ctx.messages.push({ role: 'user', content: critiqueMessage });
    this.roundCounts.set(ctx.sessionId, currentRound + 1);

    // 重置当前步骤状态，让循环继续
    ctx.currentStepText = '';
    ctx.currentStepToolCalls = [];
    return { handoff: true };
  }

  private async critique(
    response: string,
    messages: { role: string; content: string }[],
  ): Promise<number> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const userQuery = lastUser?.content ?? '';

    const prompt = this.config.critiquePrompt ?? this.defaultCritiquePrompt(userQuery, response);

    try {
      const result = await this.gateway.generateText({
        model: this.config.critiqueModel ?? 'anthropic/claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 400,
        temperature: 0,
      });

      return this.extractScore(result.content);
    } catch {
      // 如果 critique 失败，保守地返回 0（触发 revise）
      return 0;
    }
  }

  private defaultCritiquePrompt(userQuery: string, response: string): string {
    return `You are a strict quality reviewer. Evaluate the assistant response below.

User query: """${userQuery.slice(0, 800)}"""

Assistant response: """${response.slice(0, 2000)}"""

Rate the response on a scale of 0-100 considering:
- Accuracy: factual correctness
- Completeness: addresses all parts of the query
- Helpfulness: actionable and clear

Respond ONLY with a JSON object in this exact format:
{"score": number, "issues": ["issue 1", "issue 2"]}

Do not include any other text.`;
  }

  private extractScore(text: string): number {
    // 尝试 JSON 提取
    const jsonMatch = text.match(/\{[\s\S]*?"score"\s*:\s*(\d+)[\s\S]*?\}/);
    if (jsonMatch) {
      return Math.max(0, Math.min(100, parseInt(jsonMatch[1]!, 10)));
    }
    // 回退：直接找数字
    const numMatch = text.match(/\b(\d{1,3})\b/);
    if (numMatch) {
      return Math.max(0, Math.min(100, parseInt(numMatch[1]!, 10)));
    }
    return 0;
  }

  private buildCritiqueMessage(score: number, response: string): string {
    return `[System: Reflection triggered — output quality score ${score}/100 is below threshold ${this.config.qualityThreshold}. Please revise your previous answer to improve accuracy, completeness, and helpfulness.]

Previous answer: """${response.slice(0, 500)}"""`;
  }
}
