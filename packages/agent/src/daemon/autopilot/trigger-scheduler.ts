//
// TriggerScheduler — manages cron-based autopilot trigger scheduling.
//
// Provides schedule/unschedule/rescheduleAll without depending on any
// specific cron library. The server layer wires it up with node-cron.
//
// Webhook and manual triggers are handled directly by the API layer
// (no scheduling needed).
//

import type { AutopilotRepository, AutopilotTriggerRow } from '@cabinet/storage';
import type { TriggerExecutor } from './trigger-executor.js';

export interface CronAdapter {
  /** Schedule a job. Returns an opaque handle for later cancellation. */
  schedule(cronExpression: string, timezone: string, callback: () => void): unknown;
  /** Cancel a previously scheduled job by its handle. */
  cancel(handle: unknown): void;
  /** Check if a cron expression is valid. */
  validate(cronExpression: string): boolean;
}

export class TriggerScheduler {
  private jobs = new Map<string, unknown>();

  constructor(
    private readonly repo: AutopilotRepository,
    private readonly executor: TriggerExecutor,
    private readonly cron: CronAdapter,
    private readonly log: {
      info: (msg: string, ctx?: unknown) => void;
      warn: (msg: string, ctx?: unknown) => void;
      error: (msg: string, ctx?: unknown) => void;
    },
  ) {}

  /** Load and schedule all enabled cron triggers from the database. */
  rescheduleAll(): void {
    for (const [id, handle] of this.jobs) {
      this.cron.cancel(handle);
      this.jobs.delete(id);
    }

    try {
      const triggers = this.repo.findAllEnabled();
      for (const trigger of triggers) {
        if (trigger.trigger_type === 'cron' && trigger.cron_expression) {
          this.scheduleCron(trigger);
        }
      }
      this.log.info('Autopilot triggers scheduled', { count: this.jobs.size });
    } catch (err) {
      this.log.error('Failed to reschedule autopilot triggers', { error: String(err) });
    }
  }

  /** Schedule a single cron trigger. */
  scheduleCron(trigger: AutopilotTriggerRow): boolean {
    if (!trigger.cron_expression) return false;
    if (!this.cron.validate(trigger.cron_expression)) {
      this.log.warn('Invalid cron expression', {
        triggerId: trigger.id,
        cron: trigger.cron_expression,
      });
      return false;
    }

    const handle = this.cron.schedule(
      trigger.cron_expression,
      trigger.cron_timezone || 'UTC',
      () => {
        this.executor.fire(trigger).catch((err: unknown) => {
          this.log.error('Autopilot trigger execution failed', {
            triggerId: trigger.id,
            error: String(err),
          });
        });
      },
    );

    this.jobs.set(trigger.id, handle);
    this.log.info('Cron trigger scheduled', {
      triggerId: trigger.id,
      cron: trigger.cron_expression,
    });
    return true;
  }

  /** Unschedule a cron trigger. */
  unscheduleCron(triggerId: string): void {
    const handle = this.jobs.get(triggerId);
    if (handle) {
      this.cron.cancel(handle);
      this.jobs.delete(triggerId);
    }
  }

  /** Stop all scheduled jobs. */
  stop(): void {
    for (const handle of this.jobs.values()) {
      this.cron.cancel(handle);
    }
    this.jobs.clear();
  }

  /** Get the count of active scheduled jobs. */
  getScheduledCount(): number {
    return this.jobs.size;
  }
}
