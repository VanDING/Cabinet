import React, { useState, useEffect } from 'react';
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
  { id: 'emp-1', name: 'Financial Advisor', role: 'advisor', kind: 'ai', model: 'claude-sonnet-4-6', expertise: ['finance', 'investment', 'budgeting'], permissionLevel: 'read', status: 'active' },
  { id: 'emp-2', name: 'Market Analyst', role: 'analyst', kind: 'ai', model: 'claude-opus-4-7', expertise: ['market research', 'competitor analysis', 'trends'], permissionLevel: 'read', status: 'active' },
  { id: 'emp-3', name: 'Legal Advisor', role: 'advisor', kind: 'ai', model: 'claude-sonnet-4-6', expertise: ['contract law', 'compliance', 'IP'], permissionLevel: 'read', status: 'idle' },
  { id: 'emp-4', name: 'Captain', role: 'decision_maker', kind: 'human', expertise: ['strategy', 'product'], permissionLevel: 'admin', status: 'active' },
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
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);

  useEffect(() => {
    fetchEmployeesAPI()
      .then(setEmployees)
      .catch(() => {
        try {
          const raw = localStorage.getItem('cabinet-employees');
          if (raw) setEmployees(JSON.parse(raw));
        } catch {}
      });
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', role: '', kind: 'ai' as 'ai' | 'human', model: '', expertise: '' });

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    idle: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    offline: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  };

  const refreshEmployees = () => {
    fetchEmployeesAPI().then(setEmployees).catch(() => {});
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const newEmp = {
      name: form.name,
      role: form.role || 'advisor',
      kind: form.kind,
      model: form.kind === 'ai' ? (form.model || 'claude-sonnet-4-6') : undefined,
      expertise: form.expertise.split(',').map(s => s.trim()).filter(Boolean),
      permissionLevel: 'read',
      status: 'idle',
    };
    try {
      await apiFetch('/api/employees', {
        method: 'POST', headers: authJsonHeaders(),
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
    try {
      await apiFetch(`/api/employees/${id}`, { method: 'DELETE', headers: authHeaders() });
      refreshEmployees();
    } catch {
      const updated = employees.filter(e => e.id !== id);
      setEmployees(updated);
      saveLocalEmployees(updated);
    }
    if (selected === id) setSelected(null);
    if (editingId === id) setEditingId(null);
  };

  const handleStartEdit = (emp: EmployeeItem) => {
    setEditingId(emp.id);
    setForm({ name: emp.name, role: emp.role, kind: emp.kind, model: emp.model ?? '', expertise: emp.expertise.join(', ') });
    setShowForm(true);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !form.name.trim()) return;
    const update = {
      name: form.name,
      role: form.role,
      kind: form.kind,
      model: form.kind === 'ai' ? (form.model || undefined) : undefined,
      expertise: form.expertise.split(',').map(s => s.trim()).filter(Boolean),
    };
    try {
      await apiFetch(`/api/employees/${editingId}`, {
        method: 'PUT', headers: authJsonHeaders(),
        body: JSON.stringify(update),
      });
      refreshEmployees();
    } catch {
      const updated = employees.map(e => e.id === editingId ? {
        ...e, ...update,
      } : e);
      setEmployees(updated);
      saveLocalEmployees(updated);
    }
    setEditingId(null);
    setShowForm(false);
    setForm({ name: '', role: '', kind: 'ai', model: '', expertise: '' });
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Employees</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">Configure AI and human team members</span>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ name: '', role: '', kind: 'ai', model: '', expertise: '' }); }}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          {showForm ? 'Cancel' : '+ New Employee'}
        </button>
      </div>

      {showForm && (
        <div className="mb-6 border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
          <h2 className="font-semibold mb-3 text-gray-900 dark:text-gray-100">
            {editingId ? 'Edit Employee' : 'Create Employee'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <select value={form.kind}
              onChange={e => setForm(f => ({ ...f, kind: e.target.value as 'ai' | 'human' }))}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              <option value="ai">AI</option><option value="human">Human</option>
            </select>
            <input placeholder="Role (e.g. advisor)" value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            {form.kind === 'ai' && (
              <input placeholder="Model (e.g. claude-sonnet-4-6)" value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            )}
          </div>
          <div className="mt-3">
            <input placeholder="Expertise (comma-separated)" value={form.expertise}
              onChange={e => setForm(f => ({ ...f, expertise: e.target.value }))}
              className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          </div>
          <button
            onClick={editingId ? handleSaveEdit : handleCreate}
            disabled={!form.name.trim()}
            className="mt-3 w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {editingId ? 'Save Changes' : 'Create Employee'}
          </button>
        </div>
      )}

      <div className="mb-4 text-sm text-gray-500">{employees.length} team members</div>

      <div className="grid gap-3 md:grid-cols-2">
        {employees.map(emp => (
          <div key={emp.id}
            onClick={() => setSelected(selected === emp.id ? null : emp.id)}
            className={`border rounded-lg p-4 cursor-pointer transition-all bg-white dark:bg-gray-800 group
              ${selected === emp.id ? 'ring-2 ring-blue-500 border-blue-500' : 'dark:border-gray-700 hover:shadow-md'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{emp.name}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{emp.role} · {emp.kind === 'ai' ? `${emp.model}` : 'Human'}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[emp.status]}`}>{emp.status}</span>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(emp.id); }}
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                  aria-label="Delete employee"
                >&times;</button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1 mb-2">
              {emp.expertise.map(exp => (
                <span key={exp} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">{exp}</span>
              ))}
            </div>

            {selected === emp.id && (
              <div className="mt-3 pt-3 border-t dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <div>Permission: <span className="font-medium text-gray-700 dark:text-gray-300">{emp.permissionLevel}</span></div>
                <div>ID: <span className="font-mono">{emp.id}</span></div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={e => { e.stopPropagation(); handleStartEdit(emp); }}
                    className="px-3 py-1 text-xs border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-300">Configure</button>
                  {emp.kind === 'ai' && (
                    <button className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300">Test</button>
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
