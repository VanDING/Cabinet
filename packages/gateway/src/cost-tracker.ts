export interface CostEntry {
  timestamp: Date;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Number of prompt tokens served from cache (billed at cache-hit rate). */
  cachedPromptTokens: number;
  costRmb: number;
}

/** Approximate pricing per 1M tokens (RMB). Uses provider-qualified model names. */
const MODEL_PRICING: Record<
  string,
  { prompt: number; completion: number; cacheHitPrompt?: number }
> = {
  // Anthropic — USD converted to RMB at ~7.2 rate
  // Cache write costs 25% more but cache reads are ~90% cheaper
  'anthropic/claude-opus-4-7': { prompt: 108.0, completion: 540.0, cacheHitPrompt: 10.8 },
  'anthropic/claude-sonnet-4-6': { prompt: 21.6, completion: 108.0, cacheHitPrompt: 2.16 },
  'anthropic/claude-haiku-4-5': { prompt: 5.8, completion: 28.8, cacheHitPrompt: 0.58 },
  // OpenAI — USD converted to RMB at ~7.2 rate (prompt caching 50% discount)
  'openai/gpt-4o': { prompt: 18.0, completion: 72.0, cacheHitPrompt: 9.0 },
  'openai/gpt-4o-mini': { prompt: 1.1, completion: 4.3, cacheHitPrompt: 0.55 },
  // Google — USD converted to RMB at ~7.2 rate
  'google/gemini-2.5-pro': { prompt: 9.0, completion: 36.0 },
  // DeepSeek pricing (RMB — native)
  // https://api-docs.deepseek.com/zh-cn/quick_start/pricing
  // v4-flash:  ¥1/M input, ¥2/M output (cache hit: ¥0.02/M — 50x cheaper)
  // v4-pro:    ¥3/M input, ¥6/M output (cache hit: ¥0.025/M — 120x cheaper)
  'deepseek/deepseek-v4-flash': { prompt: 1.0, completion: 2.0, cacheHitPrompt: 0.02 },
  'deepseek/deepseek-v4-pro': { prompt: 3.0, completion: 6.0, cacheHitPrompt: 0.025 },
  'deepseek/deepseek-chat': { prompt: 1.0, completion: 2.0, cacheHitPrompt: 0.02 },
  'deepseek/deepseek-reasoner': { prompt: 1.0, completion: 2.0, cacheHitPrompt: 0.02 },
  'deepseek/deepseek-v3': { prompt: 2.0, completion: 8.0 },
  'deepseek/deepseek-r1': { prompt: 4.0, completion: 16.0 },
  // Keep short names for backward compatibility
  'claude-opus-4-7': { prompt: 108.0, completion: 540.0 },
  'claude-sonnet-4-6': { prompt: 21.6, completion: 108.0 },
  'claude-haiku-4-5': { prompt: 5.8, completion: 28.8 },
  'gpt-4o': { prompt: 18.0, completion: 72.0 },
  'gpt-4o-mini': { prompt: 1.1, completion: 4.3 },
  'gemini-2.5-pro': { prompt: 9.0, completion: 36.0 },
  // Qwen (通义千问) — RMB pricing
  'qwen/qwen-turbo': { prompt: 0.3, completion: 0.6 },
  'qwen/qwen-plus': { prompt: 0.8, completion: 2.0 },
  'qwen/qwen-max': { prompt: 2.8, completion: 8.4 },
  // Moonshot (Kimi) — RMB pricing
  'moonshot/moonshot-v1-8k': { prompt: 0.8, completion: 0.8 },
  'moonshot/moonshot-v1-32k': { prompt: 1.6, completion: 1.6 },
  'moonshot/moonshot-v1-128k': { prompt: 4.0, completion: 4.0 },
  // Zhipu (智谱 GLM) — RMB pricing
  'zhipu/glm-4': { prompt: 3.0, completion: 3.0 },
  'zhipu/glm-4-flash': { prompt: 0.05, completion: 0.05 },
  // Baichuan (百川) — RMB pricing
  'baichuan/baichuan4': { prompt: 3.0, completion: 3.0 },
  'baichuan/baichuan3-turbo': { prompt: 0.2, completion: 0.2 },
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

  record(
    model: string,
    promptTokens: number,
    completionTokens: number,
    cachedPromptTokens = 0,
  ): CostEntry {
    const pricing = MODEL_PRICING[model] ?? { prompt: 1.0, completion: 4.0 };
    const uncachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);
    const cachePrice = pricing.cacheHitPrompt ?? pricing.prompt;
    const costRmb =
      (uncachedPromptTokens / 1_000_000) * pricing.prompt +
      (cachedPromptTokens / 1_000_000) * cachePrice +
      (completionTokens / 1_000_000) * pricing.completion;

    const entry: CostEntry = {
      timestamp: new Date(),
      model,
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      costRmb: Math.round(costRmb * 10000) / 10000, // 4 decimal places
    };
    this.entries.push(entry);

    // Fire-and-forget persistence (don't block the caller)
    if (this.persistCallback) {
      try {
        this.persistCallback(entry);
      } catch (err) {
        console.warn('[CostTracker] Persist failed:', err);
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
    return this.entries.reduce((sum, e) => sum + e.costRmb, 0);
  }

  getEntries(): readonly CostEntry[] {
    return this.entries;
  }

  private sumCosts(since: Date): number {
    return this.entries.filter((e) => e.timestamp >= since).reduce((sum, e) => sum + e.costRmb, 0);
  }
}
