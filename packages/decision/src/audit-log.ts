import type Database from 'better-sqlite3';

export interface AuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown>;
  timestamp: Date;
}

export class AuditLogger {
  constructor(private readonly db: Database.Database) {}

  log(entry: Omit<AuditEntry, 'timestamp'>): void {
    this.db.prepare(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor, changes, timestamp)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(entry.entityType, entry.entityId, entry.action, entry.actor, JSON.stringify(entry.changes));
  }

  findByEntity(entityType: string, entityId: string): AuditEntry[] {
    const rows = this.db.prepare(
      'SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp DESC'
    ).all(entityType, entityId) as any[];
    return rows.map(r => ({
      entityType: r.entity_type, entityId: r.entity_id,
      action: r.action, actor: r.actor,
      changes: JSON.parse(r.changes), timestamp: new Date(r.timestamp),
    }));
  }

  findAll(): AuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC').all() as any[];
    return rows.map(r => ({
      entityType: r.entity_type, entityId: r.entity_id,
      action: r.action, actor: r.actor,
      changes: JSON.parse(r.changes), timestamp: new Date(r.timestamp),
    }));
  }
}
