import { EntityMemoryRepository, type Database } from '@cabinet/storage';

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
  private repo: EntityMemoryRepository | null;

  constructor(db?: Database) {
    this.repo = db ? new EntityMemoryRepository(db) : null;
    this.repo?.ensureTable();
  }

  setPreferences(captainId: string, name: string, prefs: Record<string, unknown>): void {
    const entry: EntityPreferences = { captainId, name, preferences: prefs, updatedAt: new Date() };
    this.preferences.set(captainId, entry);

    if (this.repo) {
      this.repo.upsertPreferences(captainId, name, JSON.stringify(prefs));
    }
  }

  getPreferences(captainId: string): EntityPreferences | null {
    const cached = this.preferences.get(captainId);
    if (cached) return cached;

    if (this.repo) {
      const row = this.repo.findPreferences(captainId);
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

    if (this.repo) {
      this.repo.upsertEmployee(
        employee.employeeId, employee.name, employee.role,
        JSON.stringify(employee.persona), JSON.stringify(employee.pipelineConfig),
      );
    }
  }

  getEmployee(employeeId: string): EmployeeConfig | null {
    const cached = this.employees.get(employeeId);
    if (cached) return cached;

    if (this.repo) {
      const row = this.repo.findEmployee(employeeId);
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
    if (this.repo && this.employees.size === 0) {
      const rows = this.repo.findAllEmployees();
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
