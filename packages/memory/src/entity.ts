import Database from 'better-sqlite3';

export interface EntityPreferences {
  captainId: string;
  name: string;
  preferences: Record<string, unknown>;
  updatedAt: Date;
}

export interface EmployeeConfig {
  employeeId: string;
  name: string;
  role: string;
  persona: Record<string, unknown>;
  pipelineConfig: Record<string, unknown>;
}

export class EntityMemory {
  private preferences = new Map<string, EntityPreferences>();
  private employees = new Map<string, EmployeeConfig>();
  private db: Database.Database | null;

  constructor(db?: Database.Database) {
    this.db = db ?? null;
    if (this.db) {
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
  }

  setPreferences(captainId: string, name: string, prefs: Record<string, unknown>): void {
    const entry: EntityPreferences = { captainId, name, preferences: prefs, updatedAt: new Date() };
    this.preferences.set(captainId, entry);

    if (this.db) {
      const db = this.db;
      db.prepare(
        `INSERT OR REPLACE INTO entity_prefs (captain_id, name, preferences, updated_at)
         VALUES (?, ?, ?, ?)`,
      ).run(captainId, name, JSON.stringify(prefs), entry.updatedAt.toISOString());
    }
  }

  getPreferences(captainId: string): EntityPreferences | null {
    const cached = this.preferences.get(captainId);
    if (cached) return cached;

    if (this.db) {
      const row = this.db.prepare(
        'SELECT * FROM entity_prefs WHERE captain_id = ?',
      ).get(captainId) as any;
      if (row) {
        const entry: EntityPreferences = {
          captainId: row.captain_id,
          name: row.name ?? captainId,
          preferences: JSON.parse(row.preferences ?? '{}'),
          updatedAt: new Date(row.updated_at ?? Date.now()),
        };
        this.preferences.set(captainId, entry);
        return entry;
      }
    }
    return null;
  }

  setEmployee(employee: EmployeeConfig): void {
    this.employees.set(employee.employeeId, employee);

    if (this.db) {
      const db = this.db;
      db.prepare(
        `INSERT OR REPLACE INTO entity_employees (employee_id, name, role, persona, pipeline_config)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(employee.employeeId, employee.name, employee.role,
        JSON.stringify(employee.persona), JSON.stringify(employee.pipelineConfig));
    }
  }

  getEmployee(employeeId: string): EmployeeConfig | null {
    const cached = this.employees.get(employeeId);
    if (cached) return cached;

    if (this.db) {
      const row = this.db.prepare(
        'SELECT * FROM entity_employees WHERE employee_id = ?',
      ).get(employeeId) as any;
      if (row) {
        const entry: EmployeeConfig = {
          employeeId: row.employee_id,
          name: row.name ?? '',
          role: row.role ?? '',
          persona: JSON.parse(row.persona ?? '{}'),
          pipelineConfig: JSON.parse(row.pipeline_config ?? '{}'),
        };
        this.employees.set(employeeId, entry);
        return entry;
      }
    }
    return null;
  }

  listEmployees(): EmployeeConfig[] {
    // Load all from DB into cache first
    if (this.db && this.employees.size === 0) {
      const rows = this.db.prepare('SELECT * FROM entity_employees').all() as any[];
      for (const row of rows) {
        this.employees.set(row.employee_id, {
          employeeId: row.employee_id,
          name: row.name ?? '',
          role: row.role ?? '',
          persona: JSON.parse(row.persona ?? '{}'),
          pipelineConfig: JSON.parse(row.pipeline_config ?? '{}'),
        });
      }
    }
    return [...this.employees.values()];
  }

  getAllPreferences(): Record<string, EntityPreferences> {
    const result: Record<string, EntityPreferences> = {};
    for (const [k, v] of this.preferences) result[k] = v;
    return result;
  }

  getAllEmployees(): Record<string, EmployeeConfig> {
    // Ensure DB data is loaded
    this.listEmployees();
    const result: Record<string, EmployeeConfig> = {};
    for (const [k, v] of this.employees) result[k] = v;
    return result;
  }
}
