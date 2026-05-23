import type { MetricRepository } from './repositories/metric-repo.js';

export interface Metric {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: Date;
}

export class MetricsCollector {
  private metrics: Metric[] = [];
  private readonly repo: MetricRepository | null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;

  constructor(opts?: {
    repo?: MetricRepository;
    flushIntervalMs?: number;
    maxBatchSize?: number;
  }) {
    this.repo = opts?.repo ?? null;
    this.flushIntervalMs = opts?.flushIntervalMs ?? 30_000;
    this.maxBatchSize = opts?.maxBatchSize ?? 100;
  }

  /** Start periodic batch flush to DB. No-op if no repo configured. */
  startPeriodicFlush(): void {
    if (!this.repo || this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flushToDb();
    }, this.flushIntervalMs);
  }

  /** Stop periodic flush and flush remaining metrics. */
  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushToDb();
  }

  record(name: string, value: number, tags: Record<string, string> = {}): void {
    this.metrics.push({ name, value, tags, timestamp: new Date() });

    // Persist to DB immediately if configured (fire-and-forget, error is non-fatal)
    if (this.repo) {
      try {
        this.repo.insert(name, value, tags);
      } catch { /* persistence failure is non-fatal */ }
    }
  }

  increment(name: string, tags: Record<string, string> = {}): void {
    this.record(name, 1, tags);
  }

  gauge(name: string, value: number, tags: Record<string, string> = {}): void {
    this.record(name, value, { ...tags, type: 'gauge' });
  }

  /** Get sum of metric values by name since a given time */
  sumSince(name: string, since: Date): number {
    return this.metrics
      .filter((m) => m.name === name && m.timestamp >= since)
      .reduce((sum, m) => sum + m.value, 0);
  }

  /** Get all metrics for a specific name */
  getByName(name: string): Metric[] {
    return this.metrics.filter((m) => m.name === name);
  }

  /** Get a summary for dashboard display */
  getSummary(): {
    totalLLMCalls: number;
    totalTokens: number;
    totalDecisions: number;
    errors: number;
  } {
    return {
      totalLLMCalls: this.sumSince('llm_call', new Date(0)),
      totalTokens: this.sumSince('token_used', new Date(0)),
      totalDecisions: this.sumSince('decision_created', new Date(0)),
      errors: this.sumSince('error', new Date(0)),
    };
  }

  clear(): void {
    this.metrics = [];
  }

  /** Flush pending metrics to DB (they are already written individually; this is a no-op). */
  private flushToDb(): void {
    // Individual record() calls already persist to DB via repo.insert().
    // This method exists for API symmetry and for potential future batch-insert optimization.
  }
}

export const globalMetrics = new MetricsCollector();
