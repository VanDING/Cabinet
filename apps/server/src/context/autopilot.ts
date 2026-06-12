import { TriggerScheduler, TriggerExecutor } from '@cabinet/agent';
import { AutopilotRepository } from '@cabinet/storage';
import type { CronAdapter } from '@cabinet/agent';
import cron, { type ScheduledTask } from 'node-cron';
import type { BuildState } from './build-state.js';

export function initAutopilot(state: BuildState): void {
  const { db, daemon } = state;
  if (!db || !daemon) {
    throw new Error('Missing required state for autopilot');
  }

  const autopilotRepo = new AutopilotRepository(db);
  let triggerScheduler: TriggerScheduler | null = null;
  try {
    const triggerExecutor = new TriggerExecutor(autopilotRepo, daemon);
    const cronAdapter: CronAdapter = {
      schedule(expr, tz, cb) {
        const job = cron.schedule(expr, cb, { timezone: tz });
        return job;
      },
      cancel(handle) {
        (handle as ScheduledTask).stop();
      },
      validate(expr) {
        return cron.validate(expr);
      },
    };
    triggerScheduler = new TriggerScheduler(autopilotRepo, triggerExecutor, cronAdapter, {
      info: (msg, ctx) => state.logger?.info(msg, ctx as Record<string, unknown>),
      warn: (msg, ctx) => state.logger?.warn(msg, ctx as Record<string, unknown>),
      error: (msg, ctx) => state.logger?.error(msg, ctx as Record<string, unknown>),
    });
    triggerScheduler.rescheduleAll();
    state.logger?.info('Autopilot scheduler initialized');
  } catch (e) {
    state.logger?.warn('Autopilot scheduler init failed (node-cron may not be available)', {
      error: String(e),
    });
  }

  state.autopilotRepo = autopilotRepo;
  state.triggerScheduler = triggerScheduler;
}
