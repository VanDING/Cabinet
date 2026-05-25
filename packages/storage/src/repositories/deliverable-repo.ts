import type Database from 'better-sqlite3';

export interface DeliverableRow {
  id: string;
  project_id: string;
  meeting_id: string | null;
  title: string;
  type: string;
  file_path: string | null;
  tags: string;
  created_at: string;
}

export class DeliverableRepository {
  constructor(private readonly db: Database.Database) {}

  findByProject(projectId: string): DeliverableRow[] {
    const rows = this.db
      .prepare('SELECT * FROM project_deliverables WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToDeliverable(r));
  }

  findAll(opts?: { orderBy?: string; limit?: number }): DeliverableRow[] {
    let sql = 'SELECT * FROM project_deliverables';
    if (opts?.orderBy) sql += ` ORDER BY ${opts.orderBy}`;
    else sql += ' ORDER BY created_at DESC';
    if (opts?.limit) sql += ` LIMIT ${opts.limit}`;
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToDeliverable(r));
  }

  findByType(type: string, opts?: { limit?: number; offset?: number }): DeliverableRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM project_deliverables WHERE type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      )
      .all(type, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToDeliverable(r));
  }

  insert(deliverable: DeliverableRow): void {
    this.db
      .prepare(
        'INSERT INTO project_deliverables (id, project_id, meeting_id, title, type, file_path, tags) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(deliverable.id, deliverable.project_id, deliverable.meeting_id, deliverable.title, deliverable.type, deliverable.file_path, deliverable.tags);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM project_deliverables WHERE id = ?').run(id);
  }

  private rowToDeliverable(row: Record<string, unknown>): DeliverableRow {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      meeting_id: row.meeting_id as string | null,
      title: row.title as string,
      type: row.type as string,
      file_path: row.file_path as string | null,
      tags: row.tags as string,
      created_at: row.created_at as string,
    };
  }
}
