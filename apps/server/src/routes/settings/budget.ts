import type { Hono } from 'hono';
import { getServerContext } from '../../context.js';
import { config } from '../../config.js';
import { loadSettings, saveSettings } from './persistence.js';

function loadBudget(): { daily: number; weekly: number; monthly: number } {
  try {
    const { metricRepo } = getServerContext();
    const value = metricRepo.getLatestValue('budget_limits');
    if (value) return JSON.parse(value);
  } catch {
    /* budget not configured yet */
  }
  return { daily: config.dailyBudget, weekly: config.weeklyBudget, monthly: config.monthlyBudget };
}

function saveBudget(limits: { daily: number; weekly: number; monthly: number }) {
  const { metricRepo } = getServerContext();
  metricRepo.insert('budget_limits', JSON.stringify(limits));
}

export function registerBudgetRoutes(router: Hono): void {
  router.get('/budget', (c) => {
    const budget = loadBudget();
    return c.json({
      ...budget,
      currentSpend: 0,
      budgetStatus: [],
    });
  });

  router.put('/budget', async (c) => {
    const { logger } = getServerContext();
    const body = await c.req.json();
    const parseBudget = (v: unknown, fallback: number) => {
      const n = parseFloat(String(v));
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const limits = {
      daily: parseBudget(body.daily, config.dailyBudget),
      weekly: parseBudget(body.weekly, config.weeklyBudget),
      monthly: parseBudget(body.monthly, config.monthlyBudget),
    };
    saveBudget(limits);
    saveSettings({ budgetLimits: limits });
    logger.info('Budget updated', limits);
    return c.json({ status: 'updated', ...limits });
  });
}
