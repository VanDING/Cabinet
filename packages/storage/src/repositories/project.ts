import type Database from 'better-sqlite3';
import type { Project, ProjectStatus } from '@cabinet/types';

export class ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  create(project: Project): void {
    this.db
      .prepare(
        'INSERT INTO projects (id, name, description, status, root_path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        project.id,
        project.name,
        project.description,
        project.status,
        project.rootPath ?? '',
        project.createdAt.toISOString(),
      );
  }

  findById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToProject(row);
  }

  listAll(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToProject(r));
  }

  update(id: string, changes: Partial<Pick<Project, 'name' | 'description' | 'status'>>): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (changes.name !== undefined) {
      sets.push('name = ?');
      values.push(changes.name);
    }
    if (changes.description !== undefined) {
      sets.push('description = ?');
      values.push(changes.description);
    }
    if (changes.status !== undefined) {
      sets.push('status = ?');
      values.push(changes.status);
    }

    if (sets.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  private rowToProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      status: row.status as ProjectStatus,
      rootPath: row.root_path as string,
      archived: (row.archived as number) === 1,
      lastActivityAt: row.last_activity_at as string,
      createdAt: new Date(row.created_at as string),
    };
  }
}
