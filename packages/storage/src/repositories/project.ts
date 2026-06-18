import type Database from 'better-sqlite3';
import type { Project, ProjectStatus } from '@cabinet/types';
import { buildUpdateSql } from './base-repo.js';

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

  findByName(name: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToProject(row);
  }

  listAll(opts?: { limit?: number; offset?: number }): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToProject(r));
  }

  listByStatus(status: string, opts?: { limit?: number; offset?: number }): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(status, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToProject(r));
  }

  searchByName(query: string, opts?: { limit?: number; offset?: number }): Project[] {
    const escaped = query.replace(/[%_\\]/g, '\\$&');
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(`%${escaped}%`, opts?.limit ?? 100, opts?.offset ?? 0) as Record<string, unknown>[];
    return rows.map((r) => this.rowToProject(r));
  }

  update(
    id: string,
    changes: Partial<Pick<Project, 'name' | 'description' | 'status' | 'rootPath'>> & {
      icon?: string;
    },
  ): void {
    const result = buildUpdateSql('projects', changes, {
      name: 'name',
      description: 'description',
      status: 'status',
      rootPath: 'root_path',
      icon: 'icon',
    });
    if (!result) return;
    this.db.prepare(result.sql).run(...result.values, id);
  }

  archive(id: string): void {
    this.db.prepare('UPDATE projects SET archived = 1 WHERE id = ?').run(id);
  }

  restore(id: string): void {
    this.db.prepare('UPDATE projects SET archived = 0 WHERE id = ?').run(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
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
