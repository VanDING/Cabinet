import type Database from 'better-sqlite3';
import type { MessageEnvelope } from '@cabinet/types';

export class EventLogRepository {
  constructor(private readonly db: Database.Database) {}

  append(envelope: MessageEnvelope): void {
    this.db
      .prepare(
        `INSERT INTO event_log (message_id, correlation_id, causation_id, type, payload, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        envelope.messageId,
        envelope.correlationId,
        envelope.causationId,
        envelope.messageType,
        JSON.stringify(envelope.payload),
        envelope.timestamp.toISOString(),
      );
  }

  findByCorrelationId(correlationId: string): MessageEnvelope[] {
    const rows = this.db
      .prepare('SELECT * FROM event_log WHERE correlation_id = ? ORDER BY timestamp ASC')
      .all(correlationId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEnvelope(r));
  }

  findByMessageId(messageId: string): MessageEnvelope | null {
    const row = this.db.prepare('SELECT * FROM event_log WHERE message_id = ?').get(messageId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToEnvelope(row);
  }

  findAll(opts?: { limit?: number; offset?: number }): MessageEnvelope[] {
    const rows = this.db
      .prepare('SELECT * FROM event_log ORDER BY timestamp ASC LIMIT ? OFFSET ?')
      .all(opts?.limit ?? 1000, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEnvelope(r));
  }

  findByType(type: string, opts?: { limit?: number; offset?: number }): MessageEnvelope[] {
    const rows = this.db
      .prepare('SELECT * FROM event_log WHERE type = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?')
      .all(type, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEnvelope(r));
  }

  findByTimeRange(
    from: Date,
    to: Date,
    opts?: { limit?: number; offset?: number },
  ): MessageEnvelope[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM event_log WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT ? OFFSET ?',
      )
      .all(from.toISOString(), to.toISOString(), opts?.limit ?? 1000, opts?.offset ?? 0) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToEnvelope(r));
  }

  /** Batch-append multiple events in a single transaction. */
  appendBatch(envelopes: MessageEnvelope[]): void {
    const insert = this.db.prepare(
      `INSERT INTO event_log (message_id, correlation_id, causation_id, type, payload, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const runAll = this.db.transaction(() => {
      for (const envelope of envelopes) {
        insert.run(
          envelope.messageId,
          envelope.correlationId,
          envelope.causationId,
          envelope.messageType,
          JSON.stringify(envelope.payload),
          envelope.timestamp.toISOString(),
        );
      }
    });
    runAll();
  }

  /** Prune events older than N days. Returns count of deleted rows. */
  pruneOlderThan(days: number): number {
    const result = this.db
      .prepare("DELETE FROM event_log WHERE timestamp < datetime('now', ?)")
      .run(`-${days} days`);
    return result.changes;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM event_log').get() as {
      count: number;
    };
    return row.count;
  }

  private rowToEnvelope(row: Record<string, unknown>): MessageEnvelope {
    return {
      messageId: row.message_id as string,
      correlationId: row.correlation_id as string,
      causationId: row.causation_id as string | null,
      timestamp: new Date(row.timestamp as string),
      messageType: row.type as MessageEnvelope['messageType'],
      payload: JSON.parse(row.payload as string),
    } as unknown as MessageEnvelope;
  }
}
