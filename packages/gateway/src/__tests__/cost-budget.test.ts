import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from '../cost-tracker';
import { BudgetGuard } from '../budget-guard';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it('records cost entries', () => {
    const entry = tracker.record('anthropic/claude-sonnet-4-6', 1000, 500);
    expect(entry.model).toBe('anthropic/claude-sonnet-4-6');
    expect(entry.promptTokens).toBe(1000);
    expect(entry.completionTokens).toBe(500);
    expect(entry.costUsd).toBeGreaterThan(0);
    expect(tracker.getEntries()).toHaveLength(1);
  });

  it('calculates cost correctly for known model', () => {
    const entry = tracker.record('anthropic/claude-sonnet-4-6', 1_000_000, 1_000_000);
    // Claude Sonnet: $3/M prompt, $15/M completion = $18
    expect(entry.costUsd).toBeCloseTo(18.0, 1);
  });

  it('uses default pricing for unknown model', () => {
    const entry = tracker.record('unknown-model', 1_000_000, 1_000_000);
    expect(entry.costUsd).toBeCloseTo(5.0, 1); // $1 + $4 default
  });

  it('getTotalCost sums all entries', () => {
    tracker.record('anthropic/claude-haiku-4-5', 1000, 0);
    tracker.record('anthropic/claude-haiku-4-5', 2000, 0);
    expect(tracker.getTotalCost()).toBeGreaterThan(0);
  });
});

describe('BudgetGuard', () => {
  it('returns ok when under budget', () => {
    const tracker = new CostTracker();
    const guard = new BudgetGuard(tracker, { daily: 100 });
    const statuses = guard.checkAll();
    const dailyStatus = statuses.find((s) => s.period === 'daily');
    expect(dailyStatus!.level).toBe('ok');
  });

  it('returns warning when over 80%', () => {
    const tracker = new CostTracker();
    // Simulate high cost: Claude Opus $15/M prompt
    tracker.record('anthropic/claude-opus-4-7', 300_000, 0); // ~$4.50
    const guard = new BudgetGuard(tracker, { daily: 5.0, weekly: 100, monthly: 500 });
    const statuses = guard.checkAll();
    const dailyStatus = statuses.find((s) => s.period === 'daily');
    expect(dailyStatus!.level).toBe('warning');
    expect(dailyStatus!.percentage).toBeGreaterThanOrEqual(0.8);
  });

  it('blocks non-L3 calls when budget exceeded', () => {
    const tracker = new CostTracker();
    tracker.record('anthropic/claude-opus-4-7', 500_000, 0); // ~$7.50
    const guard = new BudgetGuard(tracker, { daily: 5.0, weekly: 100, monthly: 500 });

    const nonL3 = guard.canProceed('L2');
    expect(nonL3.allowed).toBe(false);

    const l3 = guard.canProceed('L3');
    expect(l3.allowed).toBe(true);
  });
});
