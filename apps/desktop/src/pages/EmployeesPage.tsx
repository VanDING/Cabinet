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

const DEFAULT_EMPLOYEES: EmployeeItem[] = [
  {
    id: 'emp-1',
    name: 'Financial Advisor',
    role: 'advisor',
    kind: 'ai',
    model: 'claude-sonnet-4-6',
    expertise: ['finance', 'investment', 'budgeting'],
    permissionLevel: 'read',
    status: 'active',
  },
  {
    id: 'emp-2',
    name: 'Market Analyst',
    role: 'analyst',
    kind: 'ai',
    model: 'claude-opus-4-7',
    expertise: ['market research', 'competitor analysis', 'trends'],
    permissionLevel: 'read',
    status: 'active',
  },
  {
    id: 'emp-3',
    name: 'Legal Advisor',
    role: 'advisor',
    kind: 'ai',
    model: 'claude-sonnet-4-6',
    expertise: ['contract law', 'compliance', 'IP'],
    permissionLevel: 'read',
    status: 'idle',
  },
  {
    id: 'emp-4',
    name: 'Captain',
    role: 'decision_maker',
    kind: 'human',
    expertise: ['strategy', 'product'],
    permissionLevel: 'admin',
    status: 'active',
  },
];

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
    } catch { /* fall through */ }
    return DEFAULT_EMPLOYEES;
  });

  useEffect(() => {
    fetchEmployeesAPI()
      .then((emps) => {
        setEmployees(emps.length > 0 ? emps : DEFAULT_EMPLOYEES);
        saveLocalEmployees(emps.length > 0 ? emps : DEFAULT_EMPLOYEES);
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem('cabinet-employees');
          if (raw) {
            setEmployees(JSON.parse(raw));
          } else {
            setEmployees(DEFAULT_EMPLOYEES);
            saveLocalEmployees(DEFAULT_EMPLOYEES);
          }
        } catch {
          setEmployees(DEFAULT_EMPLOYEES);
          saveLocalEmployees(DEFAULT_EMPLOYEES);
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
    active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    idle: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    offline: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  };

  const refreshEmployees = () => {
    fetchEmployeesAPI()
      .then((emps) => {
        setEmployees(emps.length > 0 ? emps : DEFAULT_EMPLOYEES);
        saveLocalEmployees(emps.length > 0 ? emps : DEFAULT_EMPLOYEES);
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Employees</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Configure AI and human team members
          </span>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
            setForm({ name: '', role: '', kind: 'ai', model: '', expertise: '' });
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          {showForm ? 'Cancel' : '+ New Employee'}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 font-semibold text-gray-900 dark:text-gray-100">
            {editingId ? 'Edit Employee' : 'Create Employee'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <select
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as 'ai' | 'human' }))}
              className="rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="ai">AI</option>
              <option value="human">Human</option>
            </select>
            <input
              placeholder="Role (e.g. advisor)"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            {form.kind === 'ai' && (
              <input
                placeholder="Model (e.g. claude-sonnet-4-6)"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className="rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            )}
          </div>
          <div className="mt-3">
            <input
              placeholder="Expertise (comma-separated)"
              value={form.expertise}
              onChange={(e) => setForm((f) => ({ ...f, expertise: e.target.value }))}
              className="w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <button
            onClick={editingId ? handleSaveEdit : handleCreate}
            disabled={!form.name.trim()}
            className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {editingId ? 'Save Changes' : 'Create Employee'}
          </button>
        </div>
      )}

      <div className="mb-4 text-sm text-gray-500">{employees.length} team members</div>

      <div className="grid gap-3 md:grid-cols-2">
        {employees.map((emp) => (
          <div
            key={emp.id}
            onClick={() => setSelected(selected === emp.id ? null : emp.id)}
            className={`group cursor-pointer rounded-lg border bg-white p-4 transition-all dark:bg-gray-800 ${selected === emp.id ? 'border-blue-500 ring-2 ring-blue-500' : 'hover:shadow-md dark:border-gray-700'}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{emp.name}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
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
                  className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
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
                  className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                >
                  {exp}
                </span>
              ))}
            </div>

            {selected === emp.id && (
              <div className="mt-3 space-y-1 border-t pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <div>
                  Permission:{' '}
                  <span className="font-medium text-gray-700 dark:text-gray-300">
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
                    className="rounded border px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    Configure
                  </button>
                  {emp.kind === 'ai' && (
                    <button className="rounded bg-amber-100 px-3 py-1 text-xs text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300">
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
