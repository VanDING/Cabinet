import {
  DAILY_BUDGET,
  WEEKLY_BUDGET,
  MONTHLY_BUDGET,
  BUDGET_WARNING_THRESHOLD,
} from '@cabinet/types';
import type { BudgetPeriod } from '@cabinet/types';
import type { CostTracker } from './cost-tracker';

export interface BudgetStatus {
  period: BudgetPeriod;
  currentSpend: number;
  limit: number;
  percentage: number;
  level: 'ok' | 'warning' | 'critical' | 'blocked';
  message: string;
}

export class BudgetGuard {
  private readonly dailyLimit: number;
  private readonly weeklyLimit: number;
  private readonly monthlyLimit: number;

  constructor(
    private readonly costTracker: CostTracker,
    limits?: { daily?: number; weekly?: number; monthly?: number },
  ) {
    this.dailyLimit = limits?.daily ?? DAILY_BUDGET;
    this.weeklyLimit = limits?.weekly ?? WEEKLY_BUDGET;
    this.monthlyLimit = limits?.monthly ?? MONTHLY_BUDGET;
  }

  /** Check all budget periods. Returns the most severe status. */
  checkAll(): BudgetStatus[] {
    return [this.check('daily'), this.check('weekly'), this.check('monthly')];
  }

  /** Check if a call should be allowed based on budget. Blocks non-L3 calls when at critical or blocked. */
  canProceed(decisionLevel?: string): {
    allowed: boolean;
    reason?: string;
    degradationHint?: string;
  } {
    const statuses = this.checkAll();
    const blocked = statuses.find((s) => s.level === 'blocked');
    const critical = statuses.find((s) => s.level === 'critical');
    const warn = statuses.find((s) => s.level === 'warning');

    if (blocked && decisionLevel !== 'L3') {
      return {
        allowed: false,
        reason: `${blocked.period} budget exceeded: ¥{blocked.currentSpend.toFixed(2)} / $${blocked.limit.toFixed(2)}`,
        degradationHint:
          'Budget exhausted. Consider switching to a cheaper model (e.g., haiku instead of sonnet) for non-critical tasks.',
      };
    }
    if (critical && decisionLevel !== 'L3') {
      return {
        allowed: false,
        reason: `${critical.period} budget nearly exhausted: ¥{critical.currentSpend.toFixed(2)} / $${critical.limit.toFixed(2)}`,
        degradationHint:
          'Budget critical. Switch to cheaper models (haiku-4-5) for routine tasks to preserve budget for critical decisions.',
      };
    }
    if (warn) {
      return {
        allowed: true,
        degradationHint: `Budget warning (${warn.period} at ${Math.round(warn.percentage * 100)}%). Prefer cheaper models for non-essential tasks.`,
      };
    }
    return { allowed: true };
  }

  private check(period: BudgetPeriod): BudgetStatus {
    const limit = this.getLimit(period);
    const currentSpend = this.getSpend(period);
    const percentage = limit > 0 ? currentSpend / limit : 0;

    let level: BudgetStatus['level'];
    let message: string;

    if (percentage >= 1.0) {
      level = 'blocked';
      message = `${period} budget exhausted.`;
    } else if (percentage >= 0.95) {
      level = 'critical';
      message = `${period} budget nearly exhausted (${Math.round(percentage * 100)}%).`;
    } else if (percentage >= BUDGET_WARNING_THRESHOLD) {
      level = 'warning';
      message = `${period} budget at ${Math.round(percentage * 100)}%.`;
    } else {
      level = 'ok';
      message = `${period} budget OK (${Math.round(percentage * 100)}%).`;
    }

    return { period, currentSpend, limit, percentage, level, message };
  }

  private getLimit(period: BudgetPeriod): number {
    switch (period) {
      case 'daily':
        return this.dailyLimit;
      case 'weekly':
        return this.weeklyLimit;
      case 'monthly':
        return this.monthlyLimit;
    }
  }

  private getSpend(period: BudgetPeriod): number {
    switch (period) {
      case 'daily':
        return this.costTracker.getDailyCost();
      case 'weekly':
        return this.costTracker.getWeeklyCost();
      case 'monthly':
        return this.costTracker.getMonthlyCost();
    }
  }
}
