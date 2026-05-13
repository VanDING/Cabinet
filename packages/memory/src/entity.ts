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

  setPreferences(captainId: string, name: string, prefs: Record<string, unknown>): void {
    this.preferences.set(captainId, {
      captainId, name,
      preferences: prefs,
      updatedAt: new Date(),
    });
  }

  getPreferences(captainId: string): EntityPreferences | null {
    return this.preferences.get(captainId) ?? null;
  }

  setEmployee(employee: EmployeeConfig): void {
    this.employees.set(employee.employeeId, employee);
  }

  getEmployee(employeeId: string): EmployeeConfig | null {
    return this.employees.get(employeeId) ?? null;
  }

  listEmployees(): EmployeeConfig[] {
    return [...this.employees.values()];
  }
}
