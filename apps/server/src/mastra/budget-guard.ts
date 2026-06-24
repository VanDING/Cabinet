import { DAILY_BUDGET, MONTHLY_BUDGET } from '@cabinet/types';
import { getServerContext } from '../context.js';

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkBudget(): BudgetCheckResult {
  const ctx = getServerContext();
  const now = new Date();

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dailyCost = ctx.costHistoryRepo.sumSince(todayStart);
  if (dailyCost >= DAILY_BUDGET) {
    return {
      allowed: false,
      reason: `Daily budget exceeded: $${dailyCost.toFixed(2)} / $${DAILY_BUDGET}`,
    };
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthlyCost = ctx.costHistoryRepo.sumSince(monthStart);
  if (monthlyCost >= MONTHLY_BUDGET) {
    return {
      allowed: false,
      reason: `Monthly budget exceeded: $${monthlyCost.toFixed(2)} / $${MONTHLY_BUDGET}`,
    };
  }

  return { allowed: true };
}
