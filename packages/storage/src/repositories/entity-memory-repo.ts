import type Database from 'better-sqlite3';

export interface EntityPrefsRow {
  captain_id: string;
  name: string;
  preferences: string;
  updated_at: string;
}

export interface EntityEmployeeRow {
  employee_id: string;
  name: string;
  role: string;
  persona: string;
  pipeline_config: string;
}

export class EntityMemoryRepository {
  constructor(private readonly db: Database.Database) {}

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entity_prefs (
        captain_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        preferences TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS entity_employees (
        employee_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        persona TEXT NOT NULL DEFAULT '{}',
        pipeline_config TEXT NOT NULL DEFAULT '{}'
      );
    `);
  }

  // ── Preferences ──

  upsertPreferences(captainId: string, name: string, preferences: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO entity_prefs (captain_id, name, preferences, updated_at) VALUES (?, ?, ?, datetime('now'))",
      )
      .run(captainId, name, preferences);
  }

  findPreferences(captainId: string): EntityPrefsRow | null {
    const row = this.db
      .prepare('SELECT * FROM entity_prefs WHERE captain_id = ?')
      .get(captainId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToPrefs(row);
  }

  // ── Employees ──

  upsertEmployee(employeeId: string, name: string, role: string, persona: string, pipelineConfig: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO entity_employees (employee_id, name, role, persona, pipeline_config) VALUES (?, ?, ?, ?, ?)',
      )
      .run(employeeId, name, role, persona, pipelineConfig);
  }

  findEmployee(employeeId: string): EntityEmployeeRow | null {
    const row = this.db
      .prepare('SELECT * FROM entity_employees WHERE employee_id = ?')
      .get(employeeId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToEmployee(row);
  }

  findAllEmployees(): EntityEmployeeRow[] {
    const rows = this.db
      .prepare('SELECT * FROM entity_employees')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToEmployee(r));
  }

  private rowToPrefs(row: Record<string, unknown>): EntityPrefsRow {
    return {
      captain_id: row.captain_id as string,
      name: row.name as string,
      preferences: row.preferences as string,
      updated_at: row.updated_at as string,
    };
  }

  private rowToEmployee(row: Record<string, unknown>): EntityEmployeeRow {
    return {
      employee_id: row.employee_id as string,
      name: row.name as string,
      role: row.role as string,
      persona: row.persona as string,
      pipeline_config: row.pipeline_config as string,
    };
  }
}
