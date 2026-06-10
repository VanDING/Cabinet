import type { AgentObserver, AgentExecutionContext } from '../observer-pipeline.js';
import { ContentFilter, type ContentFilterConfig } from '../guard/content-filter.js';

/**
 * ContentGuardObserver — 内容安全守卫 Observer
 *
 * - onUserInput: 在 LLM 调用前检查用户输入，发现注入直接阻断
 * - onStreamEnd: 检查最终输出，标记可疑内容
 */
export class ContentGuardObserver implements AgentObserver {
  name = 'ContentGuard';
  private filter: ContentFilter;

  constructor(config: ContentFilterConfig) {
    this.filter = new ContentFilter(config);
  }

  async onUserInput(
    ctx: AgentExecutionContext,
    userMessage: string,
  ): Promise<{ blocked: boolean; reason?: string } | void> {
    const result = this.filter.checkInput(userMessage);
    if (result.blocked) {
      // 注入攻击：直接阻断，不进入主循环
      ctx.finalContent = `[BLOCKED] Input blocked by ContentGuard: ${result.reason}`;
      return { blocked: true, reason: result.reason };
    }
  }

  async onStreamEnd(ctx: AgentExecutionContext): Promise<void> {
    if (!ctx.finalContent) return;
    const sanitized = this.filter.sanitizeOutput(ctx.finalContent);
    if (sanitized.flagged) {
      ctx.finalContent = sanitized.text;
    }
  }
}
