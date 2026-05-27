//
// Observability — turn agent performance from feeling-based to measurable.
//
// The Harness Engineering article identifies "observability integration" as the
// key P2 item that separates Level 2 from Level 3 harness maturity. Without
// metrics, you're flying blind — you can't tell if your harness improvements
// actually help or if a model upgrade degraded performance.
//
// This module collects, stores, and reports on:
//   - Agent session metrics (steps, duration, tokens, cost)
//   - Tool call reliability (success/failure per tool)
//   - Context utilization over time
//   - Quality gate pass rates
//   - Error rates by category
//
// Inspired by OpenAI's Chrome DevTools integration for agents.
//

import type { EventBus } from '@cabinet/events';
import { MessageType } from '@cabinet/types';

// ── Metric Types ───────────────────────────────────────────────

export interface SessionMetric {
  sessionId: string;
  projectId: string;
  captainId: string;
  role: string;
  model: string;
  startTime: string;
  endTime?: string;
  totalSteps: number;
  totalTokens: { prompt: number; completion: number };
  totalCost: number;
  toolCalls: { total: number; succeeded: number; failed: number; blocked: number };
  contextZoneDistribution: { smart: number; warning: number; critical: number; dumb: number };
  contextHandoffs: number;
  qualityChecks: { total: number; passed: number };
  errors: { transient: number; recoverable: number; fatal: number };
  durationMs: number;
  /** Did the session complete successfully? */
  success: boolean;
}

export interface ToolMetric {
  toolName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  blockedCount: number;
  avgDurationMs: number;
  lastUsedAt?: string;
}

export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  sessions: number;
  totalTokens: { prompt: number; completion: number };
  totalCost: number;
  avgSteps: number;
  avgDurationMs: number;
  successRate: number; // 0–1
  toolSuccessRate: number; // 0–1
  topErrors: { category: string; count: number }[];
}

export interface ObservabilityReport {
  period: { from: string; to: string };
  sessions: { total: number; succeeded: number; failed: number };
  tokens: { prompt: number; completion: number; total: number };
  cost: { total: number; avgPerSession: number };
  performance: { avgSteps: number; avgDurationMs: number; p95DurationMs: number };
  reliability: { toolSuccessRate: number; qualityPassRate: number };
  context: {
    avgPeakUtilization: number;
    totalHandoffs: number;
    zoneDistribution: { smart: number; warning: number; critical: number; dumb: number };
  };
  topTools: ToolMetric[];
  daily: DailySnapshot[];
}

// ── Collector ──────────────────────────────────────────────────

export class ObservabilityCollector {
  private sessions: SessionMetric[] = [];
  private toolMetrics = new Map<string, ToolMetric>();

  constructor(private readonly eventBus: EventBus) {
    this.subscribe();
  }

  /** Record a completed agent session. */
  recordSession(metric: SessionMetric): void {
    this.sessions.push(metric);
    if (this.sessions.length > 10_000) {
      this.sessions.shift(); // keep bounded
    }
  }

  /** Record a tool call result. */
  recordToolCall(toolName: string, success: boolean, blocked: boolean, durationMs: number): void {
    const existing = this.toolMetrics.get(toolName) ?? {
      toolName,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      blockedCount: 0,
      avgDurationMs: 0,
    };

    existing.totalCalls++;
    if (blocked) existing.blockedCount++;
    else if (success) existing.successCount++;
    else existing.failureCount++;

    // Exponential moving average for duration
    existing.avgDurationMs =
      existing.avgDurationMs === 0 ? durationMs : existing.avgDurationMs * 0.9 + durationMs * 0.1;

    existing.lastUsedAt = new Date().toISOString();
    this.toolMetrics.set(toolName, existing);
  }

  /** Get tool metrics sorted by error rate (most error-prone first). */
  getToolHealth(): ToolMetric[] {
    return [...this.toolMetrics.values()].sort((a, b) => {
      const aErrorRate = a.failureCount / Math.max(a.totalCalls, 1);
      const bErrorRate = b.failureCount / Math.max(b.totalCalls, 1);
      return bErrorRate - aErrorRate;
    });
  }

  /** Generate a report for the given time period. */
  generateReport(from: Date, to: Date): ObservabilityReport {
    const sessions = this.sessions.filter((s) => {
      const t = new Date(s.startTime).getTime();
      return t >= from.getTime() && t <= to.getTime();
    });

    const succeeded = sessions.filter((s) => s.success).length;
    const failed = sessions.length - succeeded;

    const totalPromptTokens = sessions.reduce((sum, s) => sum + s.totalTokens.prompt, 0);
    const totalCompletionTokens = sessions.reduce((sum, s) => sum + s.totalTokens.completion, 0);
    const totalCost = sessions.reduce((sum, s) => sum + s.totalCost, 0);

    const avgSteps =
      sessions.length > 0
        ? sessions.reduce((sum, s) => sum + s.totalSteps, 0) / sessions.length
        : 0;
    const avgDuration =
      sessions.length > 0
        ? sessions.reduce((sum, s) => sum + s.durationMs, 0) / sessions.length
        : 0;

    // p95 duration — use ceil-based index for standard percentile behaviour
    const sortedDurations = sessions.map((s) => s.durationMs).sort((a, b) => a - b);
    const p95Idx = Math.max(0, Math.ceil(sortedDurations.length * 0.95) - 1);
    const p95Duration = sortedDurations[p95Idx] ?? 0;

    // Tool success rate
    const toolTotal = sessions.reduce((sum, s) => sum + s.toolCalls.total, 0);
    const toolSucceeded = sessions.reduce((sum, s) => sum + s.toolCalls.succeeded, 0);
    const toolSuccessRate = toolTotal > 0 ? toolSucceeded / toolTotal : 1;

    // Quality pass rate
    const qualityTotal = sessions.reduce((sum, s) => sum + s.qualityChecks.total, 0);
    const qualityPassed = sessions.reduce((sum, s) => sum + s.qualityChecks.passed, 0);
    const qualityPassRate = qualityTotal > 0 ? qualityPassed / qualityTotal : 1;

    // Context
    const avgPeakUtilization =
      sessions.length > 0
        ? sessions.reduce((sum, s) => {
            const max = Math.max(
              s.contextZoneDistribution.smart,
              s.contextZoneDistribution.warning,
              s.contextZoneDistribution.critical,
              s.contextZoneDistribution.dumb,
            );
            return sum + max;
          }, 0) / sessions.length
        : 0;

    const zoneDistribution = {
      smart: sessions.reduce((sum, s) => sum + s.contextZoneDistribution.smart, 0),
      warning: sessions.reduce((sum, s) => sum + s.contextZoneDistribution.warning, 0),
      critical: sessions.reduce((sum, s) => sum + s.contextZoneDistribution.critical, 0),
      dumb: sessions.reduce((sum, s) => sum + s.contextZoneDistribution.dumb, 0),
    };

    const totalHandoffs = sessions.reduce((sum, s) => sum + s.contextHandoffs, 0);

    // Daily snapshots
    const daily = this.buildDailySnapshots(sessions);

    // Top errors
    const errorCounts = new Map<string, number>();
    for (const s of sessions) {
      if (s.errors.transient > 0)
        errorCounts.set('transient', (errorCounts.get('transient') ?? 0) + s.errors.transient);
      if (s.errors.recoverable > 0)
        errorCounts.set(
          'recoverable',
          (errorCounts.get('recoverable') ?? 0) + s.errors.recoverable,
        );
      if (s.errors.fatal > 0)
        errorCounts.set('fatal', (errorCounts.get('fatal') ?? 0) + s.errors.fatal);
    }
    const topErrors = [...errorCounts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      sessions: { total: sessions.length, succeeded, failed },
      tokens: {
        prompt: totalPromptTokens,
        completion: totalCompletionTokens,
        total: totalPromptTokens + totalCompletionTokens,
      },
      cost: {
        total: Math.round(totalCost * 100) / 100,
        avgPerSession:
          sessions.length > 0 ? Math.round((totalCost / sessions.length) * 100) / 100 : 0,
      },
      performance: {
        avgSteps: Math.round(avgSteps * 10) / 10,
        avgDurationMs: Math.round(avgDuration),
        p95DurationMs: p95Duration,
      },
      reliability: {
        toolSuccessRate: Math.round(toolSuccessRate * 1000) / 1000,
        qualityPassRate: Math.round(qualityPassRate * 1000) / 1000,
      },
      context: {
        avgPeakUtilization: Math.round(avgPeakUtilization * 1000) / 1000,
        totalHandoffs,
        zoneDistribution,
      },
      topTools: this.getToolHealth().slice(0, 10),
      daily,
    };
  }

  /** Get a concise health summary (for dashboards). */
  getHealth(): {
    recentSessions: number;
    successRate: number;
    avgCostPerSession: number;
    toolHealth: 'healthy' | 'degraded' | 'unhealthy';
    contextHealth: 'healthy' | 'warning' | 'critical';
    insufficientData: boolean;
  } {
    const recent = this.sessions.slice(-50);

    // Require minimum 10 sessions before reporting meaningful health data.
    if (recent.length < 10) {
      return {
        recentSessions: recent.length,
        successRate: 1, // optimistic default when insufficient data
        avgCostPerSession: 0,
        toolHealth: 'healthy' as const,
        contextHealth: 'healthy' as const,
        insufficientData: true,
      };
    }

    const successRate =
      recent.length > 0 ? recent.filter((s) => s.success).length / recent.length : 1;

    const avgCost =
      recent.length > 0 ? recent.reduce((sum, s) => sum + s.totalCost, 0) / recent.length : 0;

    const toolErrorRate = this.getToolHealth()[0]
      ? this.getToolHealth()[0]!.failureCount / Math.max(this.getToolHealth()[0]!.totalCalls, 1)
      : 0;

    const toolHealth: 'healthy' | 'degraded' | 'unhealthy' =
      toolErrorRate < 0.05 ? 'healthy' : toolErrorRate < 0.15 ? 'degraded' : 'unhealthy';

    const dumbZoneSessions = recent.filter((s) => s.contextZoneDistribution.dumb > 0).length;
    const contextHealth: 'healthy' | 'warning' | 'critical' =
      dumbZoneSessions === 0 ? 'healthy' : dumbZoneSessions < 3 ? 'warning' : 'critical';

    return {
      recentSessions: recent.length,
      successRate: Math.round(successRate * 100) / 100,
      avgCostPerSession: Math.round(avgCost * 100) / 100,
      toolHealth,
      contextHealth,
      insufficientData: false,
    };
  }

  /** Get health metrics grouped by agent role. */
  getHealthByRole(): Map<
    string,
    {
      recentSessions: number;
      successRate: number | null; // null = insufficient data
      avgCostPerSession: number;
      contextHealth: 'healthy' | 'warning' | 'critical' | 'insufficient_data';
      insufficientData: boolean;
    }
  > {
    const MIN_SAMPLES = 5;
    const byRole = new Map<string, SessionMetric[]>();

    const recent = this.sessions.slice(-200); // broader window for per-role analysis
    for (const s of recent) {
      const list = byRole.get(s.role) ?? [];
      list.push(s);
      byRole.set(s.role, list);
    }

    const result = new Map<
      string,
      {
        recentSessions: number;
        successRate: number | null;
        avgCostPerSession: number;
        contextHealth: 'healthy' | 'warning' | 'critical' | 'insufficient_data';
        insufficientData: boolean;
      }
    >();

    for (const [role, sessions] of byRole) {
      if (sessions.length < MIN_SAMPLES) {
        result.set(role, {
          recentSessions: sessions.length,
          successRate: null,
          avgCostPerSession: 0,
          contextHealth: 'insufficient_data' as const,
          insufficientData: true,
        });
        continue;
      }

      const successRate = sessions.filter((s) => s.success).length / sessions.length;
      const avgCost = sessions.reduce((sum, s) => sum + s.totalCost, 0) / sessions.length;
      const dumbZoneSessions = sessions.filter((s) => s.contextZoneDistribution.dumb > 0).length;
      const contextHealth: 'healthy' | 'warning' | 'critical' =
        dumbZoneSessions === 0
          ? 'healthy'
          : dumbZoneSessions < Math.ceil(sessions.length * 0.1)
            ? 'warning'
            : 'critical';

      result.set(role, {
        recentSessions: sessions.length,
        successRate: Math.round(successRate * 100) / 100,
        avgCostPerSession: Math.round(avgCost * 100) / 100,
        contextHealth,
        insufficientData: false,
      });
    }
    return result;
  }

  /** Export all session data for external analysis. */
  export(): { sessions: SessionMetric[]; tools: ToolMetric[] } {
    return {
      sessions: [...this.sessions],
      tools: [...this.toolMetrics.values()],
    };
  }

  /** Reset all collected data. */
  reset(): void {
    this.sessions = [];
    this.toolMetrics.clear();
  }

  // ── Private ────────────────────────────────────────────────

  private subscribe(): void {
    // Listen for system notifications that contain metric data
    this.eventBus.subscribe(MessageType.SystemNotification, (event) => {
      const payload = event.payload as unknown as Record<string, unknown> | undefined;
      if (payload?.type === 'context_zone_alert') {
        // Zone crossing events are tracked via recordSession
      }
    });
  }

  private buildDailySnapshots(sessions: SessionMetric[]): DailySnapshot[] {
    const byDay = new Map<string, SessionMetric[]>();
    for (const s of sessions) {
      const day = s.startTime.slice(0, 10);
      const list = byDay.get(day) ?? [];
      list.push(s);
      byDay.set(day, list);
    }

    return [...byDay.entries()]
      .map(([date, daySessions]) => {
        const toolTotal = daySessions.reduce((sum, s) => sum + s.toolCalls.total, 0);
        const toolSucceeded = daySessions.reduce((sum, s) => sum + s.toolCalls.succeeded, 0);

        const errorCounts = new Map<string, number>();
        for (const s of daySessions) {
          if (s.errors.transient > 0)
            errorCounts.set('transient', (errorCounts.get('transient') ?? 0) + s.errors.transient);
          if (s.errors.recoverable > 0)
            errorCounts.set(
              'recoverable',
              (errorCounts.get('recoverable') ?? 0) + s.errors.recoverable,
            );
          if (s.errors.fatal > 0)
            errorCounts.set('fatal', (errorCounts.get('fatal') ?? 0) + s.errors.fatal);
        }

        return {
          date,
          sessions: daySessions.length,
          totalTokens: {
            prompt: daySessions.reduce((sum, s) => sum + s.totalTokens.prompt, 0),
            completion: daySessions.reduce((sum, s) => sum + s.totalTokens.completion, 0),
          },
          totalCost: Math.round(daySessions.reduce((sum, s) => sum + s.totalCost, 0) * 100) / 100,
          avgSteps:
            Math.round(
              (daySessions.reduce((sum, s) => sum + s.totalSteps, 0) / daySessions.length) * 10,
            ) / 10,
          avgDurationMs: Math.round(
            daySessions.reduce((sum, s) => sum + s.durationMs, 0) / daySessions.length,
          ),
          successRate:
            Math.round((daySessions.filter((s) => s.success).length / daySessions.length) * 1000) /
            1000,
          toolSuccessRate:
            toolTotal > 0 ? Math.round((toolSucceeded / toolTotal) * 1000) / 1000 : 1,
          topErrors: [...errorCounts.entries()]
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
