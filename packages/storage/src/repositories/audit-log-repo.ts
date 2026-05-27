import type Database from 'better-sqlite3';

export interface AuditLogRow {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  changes: string;
  timestamp: string;
}

export class AuditLogRepository {
  constructor(private readonly db: Database.Database) {}

  insert(
    entityType: string,
    entityId: string,
    action: string,
    actor: string,
    changes: Record<string, unknown> = {},
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (entity_type, entity_id, action, actor, changes) VALUES (?, ?, ?, ?, ?)',
      )
      .run(entityType, entityId, action, actor, JSON.stringify(changes));
  }

  findByEntity(
    entityType: string,
    entityId: string,
    opts?: { limit?: number; offset?: number },
  ): AuditLogRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?',
      )
      .all(entityType, entityId, opts?.limit ?? 100, opts?.offset ?? 0) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToAuditLog(r));
  }

  findByType(entityType: string, opts?: { limit?: number; offset?: number }): AuditLogRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM audit_log WHERE entity_type = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?',
      )
      .all(entityType, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAuditLog(r));
  }

  findAll(opts?: { limit?: number; offset?: number }): AuditLogRow[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ? OFFSET ?')
      .all(opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToAuditLog(r));
  }

  private rowToAuditLog(row: Record<string, unknown>): AuditLogRow {
    return {
      id: row.id as number,
      entity_type: row.entity_type as string,
      entity_id: row.entity_id as string,
      action: row.action as string,
      actor: row.actor as string,
      changes: row.changes as string,
      timestamp: row.timestamp as string,
    };
  }
}
