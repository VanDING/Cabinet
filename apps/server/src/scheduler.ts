import { DECISION_EXPIRY_HOURS } from '@cabinet/types';
import type Database from 'better-sqlite3';

export interface SchedulerLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function startAutoArchive(
  db: Database.Database,
  logger: SchedulerLogger,
  checkIntervalMs: number = 3600000,
): () => void {
  const expiryMs = DECISION_EXPIRY_HOURS * 60 * 60 * 1000;

  const check = () => {
    try {
      const cutoff = new Date(Date.now() - expiryMs).toISOString();
      const expired = db.prepare(
        "UPDATE decisions SET status = 'expired', resolved_at = datetime('now') WHERE status = 'pending' AND created_at < ?"
      ).run(cutoff);

      if (expired.changes > 0) {
        logger.info('Auto-expired decisions', { count: expired.changes });
        db.prepare("UPDATE decisions SET status = 'archived' WHERE status = 'expired'").run();
      }
    } catch (err) {
      logger.error('Auto-archive error', { error: (err as Error).message });
    }
  };

  const interval = setInterval(check, checkIntervalMs);
  logger.info('Auto-archive scheduler started', {
    intervalMinutes: checkIntervalMs / 60000,
    expiryHours: DECISION_EXPIRY_HOURS,
  });

  return () => clearInterval(interval);
}
