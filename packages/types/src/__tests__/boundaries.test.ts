import { describe, it, expect } from 'vitest';
import {
  MAX_DEBATE_ROUNDS,
  MAX_TOKENS_PER_SPEECH,
  MAX_RETRY_TRANSIENT,
  MAX_RETRY_RECOVERABLE,
  LLM_TIMEOUT_MS,
  DAILY_BUDGET_USD,
  WEEKLY_BUDGET_USD,
  MONTHLY_BUDGET_USD,
  BUDGET_WARNING_THRESHOLD,
  MEETING_COST_CONFIRM_THRESHOLD_USD,
  RUMINATION_SIMILARITY_THRESHOLD,
  DECISION_EXPIRY_HOURS,
  MAX_MEETING_ADVISORS,
  MAX_QUALITY_RETRIES,
  BACKUP_INTERVAL_MINUTES,
  BACKUP_KEEP_COUNT,
  PIN_LOCKOUT_ATTEMPTS,
  PIN_LOCKOUT_MINUTES,
} from '../boundaries';

describe('boundaries', () => {
  it('all numeric constants are positive', () => {
    const constants = [
      MAX_DEBATE_ROUNDS,
      MAX_TOKENS_PER_SPEECH,
      MAX_RETRY_TRANSIENT,
      MAX_RETRY_RECOVERABLE,
      LLM_TIMEOUT_MS,
      DAILY_BUDGET_USD,
      WEEKLY_BUDGET_USD,
      MONTHLY_BUDGET_USD,
      MEETING_COST_CONFIRM_THRESHOLD_USD,
      DECISION_EXPIRY_HOURS,
      MAX_MEETING_ADVISORS,
      MAX_QUALITY_RETRIES,
      BACKUP_INTERVAL_MINUTES,
      BACKUP_KEEP_COUNT,
      PIN_LOCKOUT_ATTEMPTS,
      PIN_LOCKOUT_MINUTES,
    ];
    for (const c of constants) {
      expect(c).toBeGreaterThan(0);
    }
  });

  it('budget warning threshold is between 0 and 1', () => {
    expect(BUDGET_WARNING_THRESHOLD).toBeGreaterThan(0);
    expect(BUDGET_WARNING_THRESHOLD).toBeLessThan(1);
  });

  it('rumination threshold is between 0 and 1', () => {
    expect(RUMINATION_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(RUMINATION_SIMILARITY_THRESHOLD).toBeLessThan(1);
  });

  it('budgets have correct hierarchy', () => {
    expect(DAILY_BUDGET_USD).toBeLessThan(WEEKLY_BUDGET_USD);
    expect(WEEKLY_BUDGET_USD).toBeLessThan(MONTHLY_BUDGET_USD);
  });

  it('retry constants have correct hierarchy', () => {
    expect(MAX_RETRY_RECOVERABLE).toBeLessThan(MAX_RETRY_TRANSIENT);
  });

  it('PIN lockout attempts is reasonable', () => {
    expect(PIN_LOCKOUT_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(PIN_LOCKOUT_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
