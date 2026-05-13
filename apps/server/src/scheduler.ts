import { DECISION_EXPIRY_HOURS } from '@cabinet/types';

/**
 * Auto-archive decisions that have been pending for longer than DECISION_EXPIRY_HOURS.
 * Runs periodically in the background.
 */
export function startAutoArchive(
  checkIntervalMs: number = 60 * 60 * 1000, // 1 hour default
  onArchive?: (decisionId: string) => void
): () => void {
  const interval = setInterval(() => {
    const now = new Date();
    const expiryMs = DECISION_EXPIRY_HOURS * 60 * 60 * 1000;

    // In production, query decisions from the store where:
    //   status = 'pending' AND created_at < now - expiryMs
    // and transition them to 'expired' → 'archived'

    console.log(`[scheduler] Auto-archive check at ${now.toISOString()}`);
    console.log(`[scheduler] Expiry threshold: ${DECISION_EXPIRY_HOURS}h`);

    // Placeholder: in production this queries the database
    if (onArchive) {
      // Example: onArchive(decision.id);
    }
  }, checkIntervalMs);

  return () => clearInterval(interval);
}
