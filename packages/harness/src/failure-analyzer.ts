import type { StepEventConfig } from '@cabinet/agent';

// Minimal Database shape to avoid direct better-sqlite3 dependency in harness
interface DatabaseLike {
  prepare(sql: string): { all(): unknown[] };
}

export interface FailurePattern {
  toolName: string;
  failureRate: number;
  totalCalls: number;
  errorTypes: Record<string, number>;
  topErrorMessage: string;
}

export interface ModelSuccessRate {
  model: string;
  successRate: number;
  totalCalls: number;
}

export interface FailureAnalysis {
  patterns: FailurePattern[];
  modelRates: ModelSuccessRate[];
  topIssues: string[];
  recommendations: string[];
}

/**
 * FailurePatternAnalyzer — 从历史数据中提取失败模式，生成优化建议。
 *
 * 优雅降级：如果 StepEventObserver 未启用，仅分析内存中的工具统计。
 */
export class FailurePatternAnalyzer {
  constructor(
    private db: DatabaseLike | null,
    private stepEventsEnabled: boolean,
  ) {}

  analyze(
    memoryStats: Array<{
      toolName: string;
      total: number;
      failed: number;
      errors: string[];
      model?: string;
    }>,
  ): FailureAnalysis {
    if (this.stepEventsEnabled && this.db) {
      try {
        return this.analyzeFromDatabase();
      } catch {
        // 降级到内存统计
      }
    }
    return this.analyzeFromMemory(memoryStats);
  }

  private analyzeFromDatabase(): FailureAnalysis {
    // 查询 step_events 表
    const toolResults = (this.db as DatabaseLike)
      .prepare(
        `SELECT
         json_extract(payload, '$.tool_name') as tool_name,
         json_extract(payload, '$.success') as success,
         json_extract(payload, '$.blocked') as blocked
       FROM step_events
       WHERE event_type = 'tool_result'`,
      )
      .all() as Array<{ tool_name: string; success: number; blocked: number }>;

    const toolMap = new Map<string, { total: number; failed: number }>();
    for (const row of toolResults) {
      const entry = toolMap.get(row.tool_name) ?? { total: 0, failed: 0 };
      entry.total++;
      if (!row.success || row.blocked) entry.failed++;
      toolMap.set(row.tool_name, entry);
    }

    const patterns: FailurePattern[] = [];
    for (const [toolName, stats] of toolMap) {
      if (stats.failed === 0) continue;
      patterns.push({
        toolName,
        failureRate: stats.failed / stats.total,
        totalCalls: stats.total,
        errorTypes: { unknown: stats.failed },
        topErrorMessage: 'See database logs',
      });
    }

    patterns.sort((a, b) => b.failureRate - a.failureRate);

    return {
      patterns: patterns.slice(0, 10),
      modelRates: [],
      topIssues: patterns
        .slice(0, 5)
        .map((p) => `${p.toolName}: ${(p.failureRate * 100).toFixed(0)}% failure`),
      recommendations: this.generateRecommendations(patterns),
    };
  }

  private analyzeFromMemory(
    stats: Array<{
      toolName: string;
      total: number;
      failed: number;
      errors: string[];
      model?: string;
    }>,
  ): FailureAnalysis {
    const patterns: FailurePattern[] = [];
    const modelMap = new Map<string, { total: number; failed: number }>();

    for (const s of stats) {
      if (s.total === 0) continue;
      const failureRate = s.failed / s.total;
      if (failureRate > 0) {
        const errorTypes = this.categorizeErrors(s.errors);
        patterns.push({
          toolName: s.toolName,
          failureRate,
          totalCalls: s.total,
          errorTypes,
          topErrorMessage: s.errors[0] ?? 'Unknown',
        });
      }

      if (s.model) {
        const m = modelMap.get(s.model) ?? { total: 0, failed: 0 };
        m.total += s.total;
        m.failed += s.failed;
        modelMap.set(s.model, m);
      }
    }

    patterns.sort((a, b) => b.failureRate - a.failureRate);

    const modelRates: ModelSuccessRate[] = [];
    for (const [model, m] of modelMap) {
      modelRates.push({
        model,
        successRate: (m.total - m.failed) / m.total,
        totalCalls: m.total,
      });
    }
    modelRates.sort((a, b) => b.successRate - a.successRate);

    return {
      patterns: patterns.slice(0, 10),
      modelRates,
      topIssues: patterns
        .slice(0, 5)
        .map((p) => `${p.toolName}: ${(p.failureRate * 100).toFixed(0)}% failure`),
      recommendations: this.generateRecommendations(patterns),
    };
  }

  private categorizeErrors(errors: string[]): Record<string, number> {
    const types: Record<string, number> = {};
    for (const e of errors) {
      const lower = e.toLowerCase();
      let category = 'unknown';
      if (lower.includes('timeout')) category = 'timeout';
      else if (lower.includes('permission') || lower.includes('access denied'))
        category = 'permission';
      else if (lower.includes('not found') || lower.includes('enoent')) category = 'not_found';
      else if (lower.includes('rate limit')) category = 'rate_limit';
      else if (lower.includes('network')) category = 'network';
      types[category] = (types[category] ?? 0) + 1;
    }
    return types;
  }

  private generateRecommendations(patterns: FailurePattern[]): string[] {
    const recs: string[] = [];
    for (const p of patterns.slice(0, 3)) {
      if (p.failureRate > 0.5) {
        recs.push(
          `Consider deprecating or replacing tool "${p.toolName}" (${(p.failureRate * 100).toFixed(0)}% failure).`,
        );
      } else if (p.failureRate > 0.2) {
        recs.push(
          `Tool "${p.toolName}" has elevated failures — review its implementation or add retry logic.`,
        );
      }
      if (p.errorTypes.timeout) {
        recs.push(`Increase timeout for "${p.toolName}" or split large inputs.`);
      }
      if (p.errorTypes.permission) {
        recs.push(`Check permissions required by "${p.toolName}".`);
      }
    }
    return recs;
  }
}
