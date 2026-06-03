import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import { useToast } from '../components/Toast.js';
import { EmployeeEditModal } from '../components/EmployeeEditModal.js';

interface EmployeeItem {
  id: string;
  name: string;
  role: string;
  kind: 'ai' | 'human';
  model?: string;
  expertise: string[];
  permissionLevel: string;
  status: 'active' | 'idle' | 'offline';
  projectId: string;
  allowedTools?: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

function saveLocalEmployees(emps: EmployeeItem[]) {
  localStorage.setItem('cabinet-employees', JSON.stringify(emps));
}

async function fetchEmployeesAPI(): Promise<EmployeeItem[]> {
  const res = await apiFetch('/api/employees', { headers: authHeaders() });
  const data = await res.json();
  return data.employees ?? [];
}

export function EmployeesPage({ activeProjectId }: { activeProjectId?: string | null }) {
  const { addToast } = useToast();
  const [employees, setEmployees] = useState<EmployeeItem[]>(() => {
    try {
      const raw = localStorage.getItem('cabinet-employees');
      if (raw) return JSON.parse(raw);
    } catch {
      /* fall through */
    }
    return [];
  });

  useEffect(() => {
    fetchEmployeesAPI()
      .then((emps) => {
        setEmployees(emps);
        saveLocalEmployees(emps);
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem('cabinet-employees');
          if (raw) {
            setEmployees(JSON.parse(raw));
          }
        } catch {
          setEmployees([]);
        }
      });
  }, []);

  const [selected, setSelected] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeItem | null>(null);

  const statusColors: Record<string, string> = {
    active: 'bg-intent-success-muted text-intent-success',
    idle: 'bg-intent-warning-muted text-intent-warning',
    offline: 'bg-surface-muted text-content-tertiary',
  };

  const permissionLabels: Record<string, string> = {
    read: 'Read',
    write: 'Write',
    admin: 'Admin',
  };

  const refreshEmployees = () => {
    fetchEmployeesAPI()
      .then((emps) => {
        setEmployees(emps);
        saveLocalEmployees(emps);
      })
      .catch((err) => { console.warn('Operation failed', err); });
  };

  const handleDelete = async (id: string) => {
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    if (!confirm(`Delete "${emp.name}"?`)) return;
    try {
      await apiFetch(`/api/employees/${id}`, { method: 'DELETE', headers: authHeaders() });
      refreshEmployees();
    } catch {
      const updated = employees.filter((e) => e.id !== id);
      setEmployees(updated);
      saveLocalEmployees(updated);
    }
    if (selected === id) setSelected(null);
  };

  const handleOpenCreate = () => {
    setEditingEmployee(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (emp: EmployeeItem) => {
    setEditingEmployee(emp);
    setModalOpen(true);
  };

  const handleSaved = () => {
    refreshEmployees();
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-content-primary">Employees</h1>
          <span className="text-sm text-content-tertiary">
            Configure AI and human team members
          </span>
        </div>
        <button
          onClick={handleOpenCreate}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-content-inverse hover:bg-accent-hover"
        >
          + New Employee
        </button>
      </div>

      <div className="mb-4 text-sm text-content-tertiary">{employees.length} team members</div>

      {employees.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-content-tertiary">No employees yet.</p>
          <p className="mt-1 text-sm text-content-tertiary">
            Create your first team member to get started.
          </p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {employees.map((emp) => (
          <div
            key={emp.id}
            onClick={() => setSelected(selected === emp.id ? null : emp.id)}
            className={`group cursor-pointer rounded-lg border border-border bg-surface-primary p-4 shadow-xs transition-all ${selected === emp.id ? 'border-accent ring-2 ring-accent' : 'hover:shadow-md'}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="truncate font-medium text-content-primary">{emp.name}</h3>
                <p className="text-xs text-content-tertiary">
                  {emp.role} · {emp.kind === 'ai' ? (emp.model || 'AI') : 'Human'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[emp.status]}`}>
                  {emp.status}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(emp.id);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded-sm text-xs text-content-tertiary opacity-0 transition-opacity hover:text-intent-danger group-hover:opacity-100"
                  aria-label="Delete employee"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="mb-2 flex flex-wrap gap-1">
              {emp.expertise.slice(0, 4).map((exp) => (
                <span
                  key={exp}
                  className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-content-secondary"
                >
                  {exp}
                </span>
              ))}
              {emp.expertise.length > 4 && (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-content-tertiary">
                  +{emp.expertise.length - 4}
                </span>
              )}
            </div>

            {/* Permission badge */}
            <div className="mb-1">
              <span className="rounded-sm bg-surface-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-content-tertiary">
                {permissionLabels[emp.permissionLevel] ?? emp.permissionLevel}
              </span>
            </div>

            {selected === emp.id && (
              <div className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs text-content-tertiary">
                <div className="flex items-center gap-2">
                  <span>ID:</span>
                  <span className="font-mono text-content-secondary">{emp.id}</span>
                </div>
                {emp.allowedTools && emp.allowedTools.length > 0 && (
                  <div>
                    <span className="text-content-tertiary">Allowed tools:</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {emp.allowedTools.slice(0, 6).map((t) => (
                        <span key={t} className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-content-secondary">
                          {t}
                        </span>
                      ))}
                      {emp.allowedTools.length > 6 && (
                        <span className="text-[10px] text-content-tertiary">+{emp.allowedTools.length - 6}</span>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenEdit(emp);
                    }}
                    className="rounded-sm border border-border px-3 py-1.5 text-xs hover:bg-surface-elevated bg-surface-input"
                  >
                    Configure
                  </button>
                  {emp.kind === 'ai' && (
                    <button className="rounded-sm bg-intent-warning-muted px-3 py-1.5 text-xs text-intent-warning hover:bg-intent-warning">
                      Test
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <EmployeeEditModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        employee={editingEmployee}
        activeProjectId={activeProjectId}
        onSaved={handleSaved}
      />
    </div>
  );
}
