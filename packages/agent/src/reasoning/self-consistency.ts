import type { LLMGateway } from '@cabinet/gateway';

export interface SelfConsistencyConfig {
  enabled: boolean;
  samples: number;
  triggerTasks: string[];
  sampleModel?: string;
  /** Temperature for sampling (default 0.7). */
  sampleTemperature?: number;
}

/**
 * Self-consistency — 多次采样并投票选择最一致的答案。
 *
 * 默认关闭，仅在 high-stakes 任务或显式配置时启用。
 */
export class SelfConsistencyEngine {
  constructor(
    private config: SelfConsistencyConfig,
    private gateway: LLMGateway,
  ) {}

  shouldTrigger(taskType: string): boolean {
    if (!this.config.enabled) return false;
    if (this.config.triggerTasks.length === 0) return true;
    return this.config.triggerTasks.includes(taskType);
  }

  /**
   * Run multiple samples and return the most common answer.
   */
  async run(
    messages: { role: 'user' | 'assistant'; content: string }[],
    systemPrompt?: string,
  ): Promise<{ content: string; confidence: number; samples: string[] }> {
    const samples: string[] = [];
    const model = this.config.sampleModel ?? 'deepseek/deepseek-chat';

    for (let i = 0; i < this.config.samples; i++) {
      try {
        const result = await this.gateway.generateText({
          model,
          messages,
          systemPrompt,
          temperature: this.config.sampleTemperature ?? 0.7,
          maxTokens: 800,
        });
        samples.push(result.content.trim());
      } catch {
        // Skip failed samples
      }
    }

    if (samples.length === 0) {
      throw new Error('All self-consistency samples failed');
    }

    const winner = this.vote(samples);
    const confidence = samples.filter((s) => s === winner).length / samples.length;

    return { content: winner, confidence, samples };
  }

  private vote(samples: string[]): string {
    // Simple exact-match voting with normalized whitespace
    const counts = new Map<string, number>();
    for (const s of samples) {
      const key = s.replace(/\s+/g, ' ').trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    let best = samples[0]!;
    let bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        best = key;
      }
    }
    return best;
  }
}
