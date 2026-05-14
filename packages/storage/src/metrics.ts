export interface Metric {
  name: string;
  value: number;
  tags: Record<string, string>;
  timestamp: Date;
}

export class MetricsCollector {
  private metrics: Metric[] = [];

  record(name: string, value: number, tags: Record<string, string> = {}): void {
    this.metrics.push({ name, value, tags, timestamp: new Date() });
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
}

export const globalMetrics = new MetricsCollector();
