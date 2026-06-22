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
  private previousOutputs = new Map<string, string>();

  constructor(
    private config: ReflectionConfig,
    private gateway: LLMGateway,
    private model?: string,
  ) {}

  /** Rough text similarity based on shared word n-grams (0-1). */
  private textSimilarity(a: string, b: string): number {
    const tokenize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const ta = tokenize(a).slice(0, 100);
    const tb = new Set(tokenize(b).slice(0, 100));
    if (ta.length === 0 || tb.size === 0) return 0;
    const intersection = ta.filter((w) => tb.has(w)).length;
    return intersection / Math.max(ta.length, tb.size);
  }

  async onStepEnd(ctx: AgentExecutionContext): Promise<{ handoff?: boolean }> {
    if (!this.config.enabled) return {};

    const isFinalAnswer = ctx.currentStepToolCalls.length === 0 && ctx.finalContent.length > 0;
    if (!isFinalAnswer) return {};

    const currentRound = this.roundCounts.get(ctx.sessionId) ?? 0;
    if (currentRound >= this.config.maxRounds) {
      this.roundCounts.delete(ctx.sessionId);
      this.previousOutputs.delete(ctx.sessionId);
      return {};
    }

    const score = await this.critique(ctx.finalContent, ctx.messages);
    if (score >= this.config.qualityThreshold) {
      this.roundCounts.delete(ctx.sessionId);
      this.previousOutputs.delete(ctx.sessionId);
      return {};
    }

    const previousOutput = this.previousOutputs.get(ctx.sessionId) ?? '';
    const similarity = previousOutput ? this.textSimilarity(ctx.finalContent, previousOutput) : 0;
    this.previousOutputs.set(ctx.sessionId, ctx.finalContent);

    let critiqueMessage: string;
    if (currentRound >= 1 && similarity > 0.7) {
      critiqueMessage = `[System] 你的回答与上一轮模式相同，都是分析和解释。现在直接输出最终答案，不要解释，不要分析原因。一句话说完。`;
    } else {
      critiqueMessage = this.buildCritiqueMessage(score, ctx.finalContent);
    }

    ctx.messages.push({ role: 'user', content: critiqueMessage });
    this.roundCounts.set(ctx.sessionId, currentRound + 1);

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
        model: this.config.critiqueModel ?? this.model ?? 'deepseek/deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 400,
        temperature: 0,
      });

      return this.extractScore(result.content);
    } catch {
      // critique API 调用失败（如 provider 不可用），返回满分跳过本轮 revise
      return this.config.qualityThreshold + 1;
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
