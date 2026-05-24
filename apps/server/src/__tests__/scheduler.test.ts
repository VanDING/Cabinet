import { describe, it, expect, vi } from 'vitest';
import { CronExpressionParser } from 'cron-parser';
import { TaskScheduler } from '../scheduler';

describe('Cron expression parsing with cron-parser', () => {
  const baseDate = new Date('2026-05-25T10:00:00Z');

  const cases: { expr: string; description: string }[] = [
    { expr: '*/5 * * * *', description: 'every 5 minutes' },
    { expr: '0 * * * *', description: 'every hour' },
    { expr: '0 0 * * *', description: 'daily at midnight' },
    { expr: '0 0 * * 0', description: 'weekly on Sunday' },
    { expr: '0 0 1 * *', description: 'monthly on 1st' },
    { expr: '0 0 1 1 *', description: 'yearly on Jan 1' },
    { expr: '0 0 L * *', description: 'last day of month' },
    { expr: '0 0 * * 1#2', description: 'second Monday' },
    { expr: '0 0 * * 1L', description: 'last Monday' },
    { expr: '0 0 ? * 2', description: 'any day-of-month on Tuesday' },
    { expr: '*/10 9-17 * * 1-5', description: 'every 10 min 9-17 weekdays' },
    { expr: '0 0 1-15 * *', description: 'daily 1st-15th' },
    { expr: '0 0,12 * * *', description: 'twice daily' },
    { expr: '*/30 8-20 * * 1-5', description: 'every 30 min work hours' },
    { expr: '0 2 * * 0', description: 'Sunday 2 AM' },
    { expr: '0 0 15 * *', description: '15th of month' },
    { expr: '0 0 1 1,7 *', description: 'Jan and July 1st' },
    { expr: '*/15 * * * *', description: 'every 15 minutes' },
    { expr: '0 8-18/2 * * 1-5', description: 'every 2 hours workday' },
    { expr: '0 0 * * 5L', description: 'last Friday' },
  ];

  it('parses all 20 expressions and yields a future date', () => {
    for (const { expr, description } of cases) {
      const parsed = CronExpressionParser.parse(expr, { currentDate: baseDate });
      const next = parsed.next().toDate();
      expect(next.getTime()).toBeGreaterThan(baseDate.getTime());
      expect(next.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    }
  });

  it('produces deterministic next dates', () => {
    const expr = '0 9 * * *';
    const p1 = CronExpressionParser.parse(expr, { currentDate: baseDate });
    const p2 = CronExpressionParser.parse(expr, { currentDate: baseDate });
    expect(p1.next().toDate().toISOString()).toBe(p2.next().toDate().toISOString());
  });

  it('handles invalid expressions with fallback', () => {
    const mockRepo = {
      insert: vi.fn(),
      findAll: vi.fn(() => []),
      disable: vi.fn(),
      findDue: vi.fn(() => []),
      updateLastRun: vi.fn(),
      updateRunTimings: vi.fn(),
    };
    const mockDecisionRepo = { expireOlderThan: vi.fn(), archiveExpired: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const scheduler = new TaskScheduler(mockRepo as any, mockDecisionRepo as any, logger as any);

    // Invalid expression should still schedule (fallback to +1 min)
    scheduler.schedule('bad-task', 'not-a-cron', 'prompt', false);
    const call = mockRepo.insert.mock.calls[0][0];
    const nextRun = new Date(call.next_run_at);
    const now = Date.now();
    expect(nextRun.getTime()).toBeGreaterThanOrEqual(now - 5000);
    expect(nextRun.getTime()).toBeLessThanOrEqual(now + 120000);
  });
});

describe('TaskScheduler CRUD', () => {
  const makeMockRepo = () => ({
    insert: vi.fn(),
    findAll: vi.fn(() => []),
    disable: vi.fn(),
    findDue: vi.fn(() => []),
    updateLastRun: vi.fn(),
    updateRunTimings: vi.fn(),
  });
  const makeMockDecisionRepo = () => ({ expireOlderThan: vi.fn(), archiveExpired: vi.fn() });
  const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  it('schedule creates a task with ISO nextRunAt', () => {
    const repo = makeMockRepo();
    const scheduler = new TaskScheduler(repo as any, makeMockDecisionRepo() as any, makeLogger() as any);
    scheduler.schedule('daily', '0 9 * * *', 'prompt', true);

    expect(repo.insert).toHaveBeenCalledOnce();
    const row = repo.insert.mock.calls[0][0];
    expect(row.name).toBe('daily');
    expect(row.cron_expression).toBe('0 9 * * *');
    expect(row.next_run_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(row.enabled).toBe(1);
  });

  it('list returns mapped tasks', () => {
    const repo = makeMockRepo();
    repo.findAll = vi.fn(() => [
      { id: 't1', name: 'a', cron_expression: '* * * * *', prompt: 'p', recurring: 1, enabled: 1, last_run_at: null, next_run_at: null },
    ]);
    const scheduler = new TaskScheduler(repo as any, makeMockDecisionRepo() as any, makeLogger() as any);
    const list = scheduler.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 't1', name: 'a', recurring: true, enabled: true });
  });

  it('cancel disables task', () => {
    const repo = makeMockRepo();
    const scheduler = new TaskScheduler(repo as any, makeMockDecisionRepo() as any, makeLogger() as any);
    scheduler.cancel('t1');
    expect(repo.disable).toHaveBeenCalledWith('t1');
  });
});
