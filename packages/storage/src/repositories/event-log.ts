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

  findAll(): MessageEnvelope[] {
    const rows = this.db.prepare('SELECT * FROM event_log ORDER BY timestamp ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToEnvelope(r));
  }

  private rowToEnvelope(row: Record<string, unknown>): MessageEnvelope {
    return {
      messageId: row.message_id as string,
      correlationId: row.correlation_id as string,
      causationId: row.causation_id as string | null,
      timestamp: new Date(row.timestamp as string),
      messageType: row.type as MessageEnvelope['messageType'],
      payload: JSON.parse(row.payload as string) as Record<string, unknown>,
    };
  }
}
