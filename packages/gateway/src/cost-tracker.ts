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
  // Regular pricing (no promotion): v4-pro ¥3/M in, ¥6/M out
  'deepseek/deepseek-v4-flash': { prompt: 0.14, completion: 0.28 },
  'deepseek/deepseek-v4-pro': { prompt: 0.42, completion: 0.84 },
  'deepseek/deepseek-chat': { prompt: 0.14, completion: 0.28 }, // deprecated → v4-flash
  'deepseek/deepseek-reasoner': { prompt: 0.14, completion: 0.28 }, // deprecated → v4-flash
  'deepseek/deepseek-v3': { prompt: 0.27, completion: 1.1 },
  'deepseek/deepseek-r1': { prompt: 0.55, completion: 2.19 },
  // Keep short names for backward compatibility
  'claude-opus-4-7': { prompt: 15.0, completion: 75.0 },
  'claude-sonnet-4-6': { prompt: 3.0, completion: 15.0 },
  'claude-haiku-4-5': { prompt: 0.8, completion: 4.0 },
  'gpt-4o': { prompt: 2.5, completion: 10.0 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gemini-2.5-pro': { prompt: 1.25, completion: 5.0 },
  // Qwen (通义千问) — https://help.aliyun.com/zh/model-studio/getting-started/models
  'qwen/qwen-turbo': { prompt: 0.04, completion: 0.1 },
  'qwen/qwen-plus': { prompt: 0.1, completion: 0.3 },
  'qwen/qwen-max': { prompt: 0.4, completion: 1.2 },
  // Moonshot (Kimi) — https://platform.moonshot.cn/docs/pricing/chat
  'moonshot/moonshot-v1-8k': { prompt: 0.12, completion: 0.12 },
  'moonshot/moonshot-v1-32k': { prompt: 0.24, completion: 0.24 },
  'moonshot/moonshot-v1-128k': { prompt: 0.6, completion: 0.6 },
  // Zhipu (智谱 GLM) — https://open.bigmodel.cn/pricing
  'zhipu/glm-4': { prompt: 0.43, completion: 0.43 },
  'zhipu/glm-4-flash': { prompt: 0.007, completion: 0.007 },
  // Baichuan (百川) — https://platform.baichuan-ai.com/price
  'baichuan/baichuan4': { prompt: 0.43, completion: 0.43 },
  'baichuan/baichuan3-turbo': { prompt: 0.03, completion: 0.03 },
};

export class CostTracker {
  private entries: CostEntry[] = [];
  private persistCallback?: (entry: CostEntry) => void;

  constructor(opts?: { persist?: (entry: CostEntry) => void }) {
    this.persistCallback = opts?.persist;
  }

  /** Restore historical entries (e.g. from DB on startup). Timestamps are preserved. */
  restore(entries: CostEntry[]): void {
    for (const entry of entries) {
      this.entries.push(entry);
    }
  }

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

    // Fire-and-forget persistence (don't block the caller)
    if (this.persistCallback) {
      try {
        this.persistCallback(entry);
      } catch {
        // Persistence failure must not break cost tracking
      }
    }

    return entry;
  }

  getDailyCost(since: Date = new Date()): number {
    const startOfDay = new Date(since.getTime());
    startOfDay.setHours(0, 0, 0, 0);
    return this.sumCosts(startOfDay);
  }

  getWeeklyCost(since: Date = new Date()): number {
    const startOfWeek = new Date(since.getTime());
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
