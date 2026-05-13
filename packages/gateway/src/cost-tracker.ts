export interface CostEntry {
  timestamp: Date;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

/** Approximate pricing per 1M tokens (USD). Expand as needed. */
const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  'claude-opus-4-7': { prompt: 15.00, completion: 75.00 },
  'claude-sonnet-4-6': { prompt: 3.00, completion: 15.00 },
  'claude-haiku-4-5': { prompt: 0.80, completion: 4.00 },
  'gpt-4o': { prompt: 2.50, completion: 10.00 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
  'gemini-2.5-pro': { prompt: 1.25, completion: 5.00 },
};

export class CostTracker {
  private entries: CostEntry[] = [];

  record(model: string, promptTokens: number, completionTokens: number): CostEntry {
    const pricing = MODEL_PRICING[model] ?? { prompt: 1.00, completion: 4.00 };
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
    return this.entries
      .filter((e) => e.timestamp >= since)
      .reduce((sum, e) => sum + e.costUsd, 0);
  }
}
