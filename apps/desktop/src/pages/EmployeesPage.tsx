import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

interface EmployeeItem {
  id: string;
  name: string;
  role: string;
  kind: 'ai' | 'human';
  model?: string;
  expertise: string[];
  permissionLevel: string;
  status: 'active' | 'idle' | 'offline';
}

function saveLocalEmployees(emps: EmployeeItem[]) {
  localStorage.setItem('cabinet-employees', JSON.stringify(emps));
}

async function fetchEmployeesAPI(): Promise<EmployeeItem[]> {
  const res = await apiFetch('/api/employees', { headers: authHeaders() });
  const data = await res.json();
  return data.employees ?? [];
}

export function EmployeesPage() {
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
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    role: '',
    kind: 'ai' as 'ai' | 'human',
    model: '',
    expertise: '',
  });

  const statusColors: Record<string, string> = {
    active: 'bg-intent-success-muted text-intent-success',
    idle: 'bg-amber-100 text-amber-700',
    offline: 'bg-surface-muted text-content-tertiary',
  };

  const refreshEmployees = () => {
    fetchEmployeesAPI()
      .then((emps) => {
        setEmployees(emps);
        saveLocalEmployees(emps);
      })
      .catch(() => {});
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const newEmp = {
      name: form.name,
      role: form.role || 'advisor',
      kind: form.kind,
      model: form.kind === 'ai' ? form.model || 'claude-sonnet-4-6' : undefined,
      expertise: form.expertise
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      permissionLevel: 'read',
      status: 'idle',
    };
    try {
      await apiFetch('/api/employees', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify(newEmp),
      });
      refreshEmployees();
    } catch {
      // Fallback to local
      const localEmp = { id: `emp_${Date.now()}`, ...newEmp } as EmployeeItem;
      const updated = [...employees, localEmp];
      setEmployees(updated);
      saveLocalEmployees(updated);
    }
    setShowForm(false);
    setForm({ name: '', role: '', kind: 'ai', model: '', expertise: '' });
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
    if (editingId === id) setEditingId(null);
  };

  const handleStartEdit = (emp: EmployeeItem) => {
    setEditingId(emp.id);
    setForm({
      name: emp.name,
      role: emp.role,
      kind: emp.kind,
      model: emp.model ?? '',
      expertise: emp.expertise.join(', '),
    });
    setShowForm(true);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !form.name.trim()) return;
    const update = {
      name: form.name,
      role: form.role,
      kind: form.kind,
      model: form.kind === 'ai' ? form.model || undefined : undefined,
      expertise: form.expertise
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      await apiFetch(`/api/employees/${editingId}`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify(update),
      });
      refreshEmployees();
    } catch {
      const updated = employees.map((e) =>
        e.id === editingId
          ? {
              ...e,
              ...update,
            }
          : e,
      );
      setEmployees(updated);
      saveLocalEmployees(updated);
    }
    setEditingId(null);
    setShowForm(false);
    setForm({ name: '', role: '', kind: 'ai', model: '', expertise: '' });
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
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
            setForm({ name: '', role: '', kind: 'ai', model: '', expertise: '' });
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-content-inverse hover:bg-accent-hover"
        >
          {showForm ? 'Cancel' : '+ New Employee'}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border bg-surface-primary p-4">
          <h2 className="mb-3 font-semibold text-content-primary">
            {editingId ? 'Edit Employee' : 'Create Employee'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded border bg-surface-primary px-3 py-2 text-sm text-content-primary"
            />
            <select
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'ai' | 'human' }))}
              className="rounded border bg-surface-primary px-3 py-2 text-sm text-content-primary"
            >
              <option value="ai">AI</option>
              <option value="human">Human</option>
            </select>
            <input
              placeholder="Role (e.g. advisor)"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="rounded border bg-surface-primary px-3 py-2 text-sm text-content-primary"
            />
            {form.kind === 'ai' && (
              <input
                placeholder="Model (e.g. claude-sonnet-4-6)"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className="rounded border bg-surface-primary px-3 py-2 text-sm text-content-primary"
              />
            )}
          </div>
          <div className="mt-3">
            <input
              placeholder="Expertise (comma-separated)"
              value={form.expertise}
              onChange={(e) => setForm((f) => ({ ...f, expertise: e.target.value }))}
              className="w-full rounded border bg-surface-primary px-3 py-2 text-sm text-content-primary"
            />
          </div>
          <button
            onClick={editingId ? handleSaveEdit : handleCreate}
            disabled={!form.name.trim()}
            className="mt-3 w-full rounded-lg bg-accent py-2 text-sm text-content-inverse hover:bg-accent-hover disabled:opacity-50"
          >
            {editingId ? 'Save Changes' : 'Create Employee'}
          </button>
        </div>
      )}

      <div className="mb-4 text-sm text-content-tertiary">{employees.length} team members</div>

      {employees.length === 0 && !showForm && (
        <div className="rounded-lg border border-dashed p-8 text-center">
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
            className={`group cursor-pointer rounded-lg border bg-surface-primary p-4 transition-all ${selected === emp.id ? 'border-accent ring-2 ring-accent' : 'hover:shadow-md'}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-content-primary">{emp.name}</h3>
                <p className="text-xs text-content-tertiary">
                  {emp.role} · {emp.kind === 'ai' ? `${emp.model}` : 'Human'}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-xs ${statusColors[emp.status]}`}>
                  {emp.status}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(emp.id);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-xs text-content-tertiary opacity-0 transition-opacity hover:text-intent-danger group-hover:opacity-100"
                  aria-label="Delete employee"
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="mb-2 flex flex-wrap gap-1">
              {emp.expertise.map((exp) => (
                <span
                  key={exp}
                  className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-content-secondary"
                >
                  {exp}
                </span>
              ))}
            </div>

            {selected === emp.id && (
              <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-content-tertiary">
                <div>
                  Permission:{' '}
                  <span className="font-medium text-content-secondary">
                    {emp.permissionLevel}
                  </span>
                </div>
                <div>
                  ID: <span className="font-mono">{emp.id}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit(emp);
                    }}
                    className="rounded border px-3 py-1 text-xs hover:bg-surface-elevated bg-surface-input"
                  >
                    Configure
                  </button>
                  {emp.kind === 'ai' && (
                    <button className="rounded bg-amber-100 px-3 py-1 text-xs text-amber-700 hover:bg-amber-200">
                      Test
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
