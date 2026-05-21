export interface CostEntry {
  timestamp: Date;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/** Approximate pricing per 1M tokens (USD). Uses provider-qualified model names. */
const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  'anthropic/claude-opus-4-7': { prompt: 15.0, completion: 75.0 },
  'anthropic/claude-sonnet-4-6': { prompt: 3.0, completion: 15.0 },
  'anthropic/claude-haiku-4-5': { prompt: 0.8, completion: 4.0 },
  'openai/gpt-4o': { prompt: 2.5, completion: 10.0 },
  'openai/gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'google/gemini-2.5-pro': { prompt: 1.25, completion: 5.0 },
  // DeepSeek pricing (RMB converted to USD at ~0.14 rate)
  // https://api-docs.deepseek.com/zh-cn/quick_start/pricing
  // deepseek-v4-pro currently 75% off until 2026/05/31 (¥3→¥0.42 / ¥6→¥0.84)
  'deepseek/deepseek-v4-flash': { prompt: 0.14, completion: 0.28 },
  'deepseek/deepseek-v4-pro': { prompt: 1.68, completion: 3.36 },
  'deepseek/deepseek-chat': { prompt: 0.14, completion: 0.28 },     // deprecated → v4-flash
  'deepseek/deepseek-reasoner': { prompt: 0.14, completion: 0.28 },  // deprecated → v4-flash
  'deepseek/deepseek-v3': { prompt: 0.27, completion: 1.10 },
  'deepseek/deepseek-r1': { prompt: 0.55, completion: 2.19 },
  // Keep short names for backward compatibility
  'claude-opus-4-7': { prompt: 15.0, completion: 75.0 },
  'claude-sonnet-4-6': { prompt: 3.0, completion: 15.0 },
  'claude-haiku-4-5': { prompt: 0.8, completion: 4.0 },
  'gpt-4o': { prompt: 2.5, completion: 10.0 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gemini-2.5-pro': { prompt: 1.25, completion: 5.0 },
};

export class CostTracker {
  private entries: CostEntry[] = [];

  record(model: string, promptTokens: number, completionTokens: number): CostEntry {
    const pricing = MODEL_PRICING[model] ?? { prompt: 1.0, completion: 4.0 };
    const costUsd =
      (promptTokens / 1_000_000) * pricing.prompt +
      (completionTokens / 1_000_000) * pricing.completion;

    const entry: CostEntry = {
      timestamp: new Date(),
      model,
      promptTokens,
      completionTokens,
      costUsd: Math.round(costUsd * 10000) / 10000, // 4 decimal places
    };
    this.entries.push(entry);
    return entry;
  }

  getDailyCost(since: Date = new Date()): number {
    const startOfDay = new Date(since);
    startOfDay.setHours(0, 0, 0, 0);
    return this.sumCosts(startOfDay);
  }

  getWeeklyCost(since: Date = new Date()): number {
    const startOfWeek = new Date(since);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    return this.sumCosts(startOfWeek);
  }

  getMonthlyCost(since: Date = new Date()): number {
    const startOfMonth = new Date(since.getFullYear(), since.getMonth(), 1);
    return this.sumCosts(startOfMonth);
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.costUsd, 0);
  }

  getEntries(): readonly CostEntry[] {
    return this.entries;
  }

  private sumCosts(since: Date): number {
    return this.entries.filter((e) => e.timestamp >= since).reduce((sum, e) => sum + e.costUsd, 0);
  }
}
