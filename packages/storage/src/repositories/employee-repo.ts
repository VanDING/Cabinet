import type Database from 'better-sqlite3';

export interface EmployeeRow {
  id: string;
  project_id: string;
  name: string;
  role: string;
  kind: string;
  pipeline_config: string | null;
  persona: string | null;
  permission_level: string;
}

export class EmployeeRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(): EmployeeRow[] {
    const rows = this.db.prepare('SELECT * FROM employees ORDER BY name ASC').all() as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToEmployee(r));
  }

  findById(id: string): EmployeeRow | null {
    const row = this.db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return this.rowToEmployee(row);
  }

  insert(emp: EmployeeRow): void {
    this.db
      .prepare(
        'INSERT INTO employees (id, project_id, name, role, kind, pipeline_config, persona, permission_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        emp.id,
        emp.project_id,
        emp.name,
        emp.role,
        emp.kind,
        emp.pipeline_config,
        emp.persona,
        emp.permission_level,
      );
  }

  update(
    id: string,
    changes: Partial<
      Pick<
        EmployeeRow,
        'name' | 'role' | 'kind' | 'pipeline_config' | 'persona' | 'permission_level'
      >
    >,
  ): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      name: 'name',
      role: 'role',
      kind: 'kind',
      pipeline_config: 'pipeline_config',
      persona: 'persona',
      permission_level: 'permission_level',
    };
    for (const [key, col] of Object.entries(map)) {
      const val = (changes as Record<string, unknown>)[key];
      if (val !== undefined) {
        sets.push(`${col} = ?`);
        values.push(val);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE employees SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM employees WHERE id = ?').run(id);
  }

  deleteByProject(projectId: string): void {
    this.db.prepare('DELETE FROM employees WHERE project_id = ?').run(projectId);
  }

  private rowToEmployee(row: Record<string, unknown>): EmployeeRow {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      name: row.name as string,
      role: row.role as string,
      kind: row.kind as string,
      pipeline_config: row.pipeline_config as string | null,
      persona: row.persona as string | null,
      permission_level: row.permission_level as string,
    };
  }
}
