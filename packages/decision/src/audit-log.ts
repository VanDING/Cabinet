import { AuditLogRepository, type Database } from '@cabinet/storage';

export interface AuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown>;
  timestamp: Date;
}

export class AuditLogger {
  private readonly repo: AuditLogRepository;

  constructor(db: Database) {
    this.repo = new AuditLogRepository(db);
  }

  log(entry: Omit<AuditEntry, 'timestamp'>): void {
    this.repo.insert(entry.entityType, entry.entityId, entry.action, entry.actor, entry.changes);
  }

  findByEntity(entityType: string, entityId: string): AuditEntry[] {
    const rows = this.repo.findByEntity(entityType, entityId);
    return rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actor: r.actor,
      changes: JSON.parse(r.changes),
      timestamp: new Date(r.timestamp),
    }));
  }

  findAll(): AuditEntry[] {
    const rows = this.repo.findAll();
    return rows.map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actor: r.actor,
      changes: JSON.parse(r.changes),
      timestamp: new Date(r.timestamp),
    }));
  }
}
