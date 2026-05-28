import type { MessageEnvelope } from '@cabinet/types';
import type { Database } from '@cabinet/storage';

export interface DeadLetterEntry {
  id: string;
  envelope: MessageEnvelope;
  error: string;
  stack?: string;
  handlerName: string;
  messageType: string;
  failedAt: string;
  retryCount: number;
  lastRetryAt?: string;
}

export class DeadLetterQueue {
  private readonly entries: DeadLetterEntry[] = [];
  private retryBus: { publish(envelope: MessageEnvelope): Promise<void> } | null = null;
  private db: Database | null = null;

  /** Set the bus used for retry attempts. */
  setRetryBus(bus: { publish(envelope: MessageEnvelope): Promise<void> }): void {
    this.retryBus = bus;
  }

  /**
   * Enable SQLite persistence for dead-letter entries.
   * The dead_letter_queue table must exist (created by migration 010).
   */
  setDb(db: Database): void {
    this.db = db;
    // Load persisted entries on startup
    try {
      const rows = db
        .prepare('SELECT * FROM dead_letter_queue ORDER BY failed_at DESC')
        .all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        try {
          const raw = JSON.parse(row.envelope_json as string);
          const envelope: MessageEnvelope = {
            ...raw,
            timestamp: new Date(raw.timestamp),
          };
          this.entries.push({
            id: row.id as string,
            envelope,
            error: row.error as string,
            stack: row.stack as string | undefined,
            handlerName: row.handler_name as string,
            messageType: row.message_type as string,
            failedAt: row.failed_at as string,
            retryCount: row.retry_count as number,
            lastRetryAt: row.last_retry_at as string | undefined,
          });
        } catch {
          /* skip corrupted entries */
        }
      }
    } catch {
      /* table may not exist yet */
    }
  }

  enqueue(entry: Omit<DeadLetterEntry, 'id' | 'retryCount'>): void {
    const id = `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullEntry: DeadLetterEntry = { ...entry, id, retryCount: 0 };
    this.entries.push(fullEntry);

    // Persist to DB if configured
    if (this.db) {
      try {
        this.db
          .prepare(
            `INSERT INTO dead_letter_queue (id, envelope_json, error, stack, handler_name, message_type, failed_at, retry_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
          )
          .run(
            id,
            JSON.stringify(entry.envelope),
            entry.error,
            entry.stack ?? null,
            entry.handlerName,
            entry.messageType,
            entry.failedAt,
          );
      } catch (e) {
        console.warn('[DeadLetterQueue] Failed to persist enqueue:', (e as Error).message);
      }
    }
  }

  list(): readonly DeadLetterEntry[] {
    return [...this.entries];
  }

  get(id: string): DeadLetterEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Retry a single failed event by re-publishing to the bus. */
  async retry(id: string): Promise<boolean> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || !this.retryBus) return false;

    try {
      await this.retryBus.publish(entry.envelope);
      this.purge(id);
      return true;
    } catch {
      entry.retryCount++;
      entry.lastRetryAt = new Date().toISOString();
      // Update retry count in DB
      if (this.db) {
        try {
          this.db
            .prepare('UPDATE dead_letter_queue SET retry_count = ?, last_retry_at = ? WHERE id = ?')
            .run(entry.retryCount, entry.lastRetryAt, id);
        } catch (e) {
          console.warn('[DeadLetterQueue] Failed to persist retry update:', (e as Error).message);
        }
      }
      return false;
    }
  }

  /** Retry all failed events. Returns count of successful retries. */
  async retryAll(): Promise<number> {
    let successCount = 0;
    const entries = [...this.entries];
    for (const entry of entries) {
      const ok = await this.retry(entry.id);
      if (ok) successCount++;
    }
    return successCount;
  }

  purge(id: string): void {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx !== -1) this.entries.splice(idx, 1);
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM dead_letter_queue WHERE id = ?').run(id);
      } catch (e) {
        console.warn('[DeadLetterQueue] Failed to persist purge:', (e as Error).message);
      }
    }
  }

  purgeAll(): void {
    this.entries.length = 0;
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM dead_letter_queue').run();
      } catch (e) {
        console.warn('[DeadLetterQueue] Failed to persist purgeAll:', (e as Error).message);
      }
    }
  }

  get count(): number {
    return this.entries.length;
  }
}
