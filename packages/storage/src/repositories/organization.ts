import type Database from 'better-sqlite3';
import type { Organization } from '@cabinet/types';

export class OrganizationRepository {
  constructor(private readonly db: Database.Database) {}

  create(org: Organization): void {
    this.db
      .prepare('INSERT INTO organizations (id, name, captain_id, created_at) VALUES (?, ?, ?, ?)')
      .run(org.id, org.name, org.captainId, org.createdAt.toISOString());
  }

  findById(id: string): Organization | null {
    const row = this.db
      .prepare('SELECT * FROM organizations WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToOrg(row);
  }

  listAll(): Organization[] {
    const rows = this.db.prepare('SELECT * FROM organizations ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToOrg(r));
  }

  private rowToOrg(row: Record<string, unknown>): Organization {
    return {
      id: row.id as string,
      name: row.name as string,
      captainId: row.captain_id as string,
      createdAt: new Date(row.created_at as string),
    };
  }
}
