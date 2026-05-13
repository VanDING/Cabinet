import { DECISION_EXPIRY_HOURS } from '@cabinet/types';
import type Database from 'better-sqlite3';

export function startAutoArchive(db: Database.Database, checkIntervalMs: number = 3600000): () => void {
  const expiryMs = DECISION_EXPIRY_HOURS * 60 * 60 * 1000;

  const check = () => {
    try {
      const cutoff = new Date(Date.now() - expiryMs).toISOString();
      const expired = db.prepare(
        "UPDATE decisions SET status = 'expired', resolved_at = datetime('now') WHERE status = 'pending' AND created_at < ?"
      ).run(cutoff);

      if (expired.changes > 0) {
        console.log(`[scheduler] Auto-expired ${expired.changes} decision(s)`);
        // Archive expired decisions
        db.prepare("UPDATE decisions SET status = 'archived' WHERE status = 'expired'").run();
      }
    } catch (err) {
      console.error('[scheduler] Auto-archive error:', (err as Error).message);
    }
  };

  const interval = setInterval(check, checkIntervalMs);
  console.log(`[scheduler] Auto-archive started (checking every ${checkIntervalMs / 60000} min, ${DECISION_EXPIRY_HOURS}h expiry)`);

  return () => clearInterval(interval);
}
