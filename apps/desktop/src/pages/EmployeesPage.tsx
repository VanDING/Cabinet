import React, { useState } from 'react';
import { useProject } from '../hooks/useProject';

interface EmployeeItem {
  id: string;
  name: string;
  role: string;
  kind: 'ai' | 'human';
  model?: string;
  expertise: string[];
  permissionLevel: string;
  status: 'active' | 'idle' | 'offline';
  projectId?: string;
  projectName?: string;
}

const demoEmployees: EmployeeItem[] = [
  { id: 'emp-1', name: 'Financial Advisor', role: 'advisor', kind: 'ai', model: 'claude-sonnet-4-6', expertise: ['finance', 'investment', 'budgeting'], permissionLevel: 'read', status: 'active', projectId: 'proj-1', projectName: 'Product Launch Q3' },
  { id: 'emp-2', name: 'Market Analyst', role: 'analyst', kind: 'ai', model: 'claude-opus-4-7', expertise: ['market research', 'competitor analysis', 'trends'], permissionLevel: 'read', status: 'active', projectId: 'proj-1', projectName: 'Product Launch Q3' },
  { id: 'emp-3', name: 'Legal Advisor', role: 'advisor', kind: 'ai', model: 'claude-sonnet-4-6', expertise: ['contract law', 'compliance', 'IP'], permissionLevel: 'read', status: 'idle', projectId: 'proj-2', projectName: 'Cost Optimization' },
  { id: 'emp-4', name: 'Captain', role: 'decision_maker', kind: 'human', expertise: ['strategy', 'product'], permissionLevel: 'admin', status: 'active', projectId: 'proj-1', projectName: 'Product Launch Q3' },
];

export function EmployeesPage() {
  const [employees] = useState<EmployeeItem[]>(demoEmployees);
  const [selected, setSelected] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { current } = useProject();

  const filtered = employees.filter(e => !e.projectId || e.projectId === current.id);
  const showingCount = filtered.length;

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    idle: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    offline: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Employees</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">Configure AI and human team members</span>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
          {showForm ? 'Cancel' : '+ New Employee'}
        </button>
      </div>

      <div className="mb-4 text-sm text-gray-500">
        Showing {showingCount} of {employees.length} employees for project "{current.name}"
      </div>

      {showForm && (
        <div className="mb-6 border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
          <h2 className="font-semibold mb-3 text-gray-900 dark:text-gray-100">Create Employee</h2>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Name" className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <select className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
              <option>AI</option><option>Human</option>
            </select>
            <input placeholder="Role (e.g. advisor)" className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
            <input placeholder="Model (e.g. claude-sonnet-4-6)" className="border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          </div>
          <div className="mt-3">
            <input placeholder="Expertise (comma-separated)" className="w-full border dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
          </div>
          <button className="mt-3 w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">Create Employee</button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map(emp => (
          <div key={emp.id}
            onClick={() => setSelected(selected === emp.id ? null : emp.id)}
            className={`border rounded-lg p-4 cursor-pointer transition-all bg-white dark:bg-gray-800
              ${selected === emp.id ? 'ring-2 ring-blue-500 border-blue-500' : 'dark:border-gray-700 hover:shadow-md'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{emp.name}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{emp.role} · {emp.kind === 'ai' ? `${emp.model}` : 'Human'}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                  <span>&#x1F4C2;</span> {emp.projectName ?? 'Unassigned'}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[emp.status]}`}>{emp.status}</span>
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
                  <button className="px-3 py-1 text-xs border rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-gray-300">Configure</button>
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
