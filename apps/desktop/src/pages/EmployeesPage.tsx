import { useState, useEffect, useMemo } from 'react';
import { Search, Plus } from 'lucide-react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import { useToast } from '../components/Toast.js';
import { EmployeeEditModal } from '../components/EmployeeEditModal.js';
import { ModalOverlay } from '../components/ModalOverlay.js';
import { AgentBadge } from '../components/AgentBadge.js';

interface EmployeeItem {
  id: string;
  name: string;
  role: string;
  kind: 'ai' | 'human';
  source?: 'builtin' | 'custom' | 'external_cli' | 'external_a2a';
  external?: Record<string, unknown>;
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

async function fetchEmployeesAPI(): Promise<EmployeeItem[]> {
  const res = await apiFetch('/api/employees', { headers: authHeaders() });
  const data = await res.json();
  return data.employees ?? [];
}

type KindFilter = 'all' | 'ai' | 'human';
export function EmployeesPage({ activeProjectId }: { activeProjectId?: string | null }) {
  const { addToast } = useToast();
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeItem | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<EmployeeItem | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchEmployeesAPI()
      .then((emps) => setEmployees(emps))
      .catch(() => {
        // Fallback to localStorage on failure
        try {
          const raw = localStorage.getItem('cabinet-employees');
          if (raw) setEmployees(JSON.parse(raw));
        } catch {
          setEmployees([]);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const refreshEmployees = () => {
    fetchEmployeesAPI()
      .then((emps) => setEmployees(emps))
      .catch((err) => {
        console.warn('Operation failed', err);
      });
  };

  const filtered = useMemo(() => {
    let result = employees;
    if (kindFilter !== 'all') {
      result = result.filter((e) => e.kind === kindFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.role.toLowerCase().includes(q) ||
          e.expertise.some((ex) => ex.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [employees, kindFilter, searchQuery]);

  const handleDelete = async (id: string) => {
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    if (!confirm(`Delete "${emp.name}"?`)) return;
    try {
      await apiFetch(`/api/employees/${id}`, { method: 'DELETE', headers: authHeaders() });
      refreshEmployees();
    } catch {
      addToast('error', 'Failed to delete employee');
    }
    if (detailEmployee?.id === id) setDetailEmployee(null);
  };

  const handleOpenCreate = () => {
    setEditingEmployee(null);
    setModalOpen(true);
  };

  const handleOpenCreateHuman = () => {
    setEditingEmployee(null);
    setModalOpen(true);
  };

  const handleRegisterA2A = () => {
    const url = window.prompt('Enter A2A Agent URL:');
    if (!url) return;
    apiFetch('/api/agents/discover', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.discovered) {
          window.dispatchEvent(
            new CustomEvent('toast', {
              detail: { type: 'success', message: 'A2A agent registered' },
            }),
          );
        }
      })
      .catch(() => {
        window.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'error', message: 'Failed to register A2A agent' },
          }),
        );
      });
  };

  const handleOpenEdit = (emp: EmployeeItem) => {
    setEditingEmployee(emp);
    setModalOpen(true);
    setDetailEmployee(null);
  };

  const handleSaved = () => {
    refreshEmployees();
  };

  const handleTest = async (id: string, name: string) => {
    setTestingId(id);
    try {
      const res = await apiFetch(`/api/employees/${id}/test`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.status === 'ok') {
        addToast('success', `${name}: OK — ${data.latency_ms}ms · ${data.model}`);
      } else {
        addToast('error', `${name}: ${data.message ?? 'Connection failed'}`);
      }
    } catch (e) {
      addToast('error', `${name}: ${(e as Error).message}`);
    } finally {
      setTestingId(null);
    }
  };

  const sourceLabels: Record<string, string> = {
    builtin: '内置',
    custom: '自定义',
    external_cli: 'CLI',
    external_a2a: 'A2A',
  };

  const statusDotClass: Record<string, string> = {
    active: 'bg-intent-success',
    idle: 'bg-intent-warning',
    offline: 'bg-content-tertiary',
  };

  const permissionLabels: Record<string, string> = {
    read: 'Read',
    write: 'Write',
    admin: 'Admin',
  };

  const filterButtonClass = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-accent text-content-inverse'
        : 'border border-border text-content-secondary hover:bg-surface-muted'
    }`;

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-content-primary text-2xl font-bold">Employees</h1>
          <span className="text-content-tertiary text-sm">Configure AI and human team members</span>
        </div>
        <div className="relative">
          <button
            onClick={() => setAddMenuOpen(!addMenuOpen)}
            className="bg-accent text-content-inverse hover:bg-accent-hover inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus size={16} />
            Add
          </button>
          {addMenuOpen && (
            <div
              className="border-border bg-surface-primary absolute top-full right-0 z-50 mt-1 w-52 rounded-lg border py-1 shadow-xl"
              onClick={() => setAddMenuOpen(false)}
            >
              <button
                className="text-content-secondary hover:bg-surface-muted w-full px-3 py-2 text-left text-sm"
                onClick={() => {
                  setAddMenuOpen(false);
                  handleOpenCreateHuman();
                }}
              >
                Add Human Employee
              </button>
              <button
                className="text-content-secondary hover:bg-surface-muted w-full px-3 py-2 text-left text-sm"
                onClick={() => {
                  setAddMenuOpen(false);
                  handleOpenCreate();
                }}
              >
                Add Custom AI Agent
              </button>
              <button
                className="text-content-secondary hover:bg-surface-muted w-full px-3 py-2 text-left text-sm"
                onClick={() => {
                  setAddMenuOpen(false);
                  handleRegisterA2A();
                }}
              >
                Register A2A Agent
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setKindFilter('all')}
          className={filterButtonClass(kindFilter === 'all')}
        >
          All
        </button>
        <button
          onClick={() => setKindFilter('ai')}
          className={filterButtonClass(kindFilter === 'ai')}
        >
          AI
        </button>
        <button
          onClick={() => setKindFilter('human')}
          className={filterButtonClass(kindFilter === 'human')}
        >
          Human
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Search size={14} className="text-content-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="border-border bg-surface-primary text-content-primary placeholder:text-content-tertiary focus:ring-accent w-40 rounded-lg border px-3 py-1 text-xs focus:ring-1 focus:outline-hidden"
          />
        </div>
      </div>

      <div className="text-content-tertiary mb-4 text-sm">{filtered.length} team members</div>

      {loading && employees.length === 0 && (
        <div className="flex h-64 items-center justify-center">
          <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="border-border rounded-lg border border-dashed p-8 text-center">
          <p className="text-content-tertiary">No employees match the filter.</p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((emp) => (
          <AgentBadge
            key={emp.id}
            name={emp.name}
            model={emp.model}
            kind={emp.kind}
            source={emp.source}
            status={emp.status}
            expertise={emp.expertise}
            permissionLevel={emp.permissionLevel}
            onClick={() => setDetailEmployee(emp)}
            onConfigure={() => handleOpenEdit(emp)}
            onTest={() => handleTest(emp.id, emp.name)}
            onDelete={() => handleDelete(emp.id)}
          />
        ))}
      </div>

      {/* Detail Modal */}
      {detailEmployee && (
        <ModalOverlay
          isOpen={!!detailEmployee}
          onClose={() => setDetailEmployee(null)}
          contentClassName="w-full max-w-md rounded-xl border border-border bg-surface-overlay p-0 shadow-2xl overflow-hidden"
          backdropClassName="items-start justify-center pt-16"
        >
          <div className="px-6 pt-5 pb-3">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${statusDotClass[detailEmployee.status]}`}
              />
              <h2 className="text-content-primary text-lg font-semibold">{detailEmployee.name}</h2>
            </div>
            <p className="text-content-tertiary mt-0.5 text-xs">
              {detailEmployee.kind === 'ai'
                ? `AI · ${detailEmployee.model || 'Unknown model'}`
                : `Human · ${detailEmployee.role}`}
              {detailEmployee.source && (
                <span className="bg-surface-muted ml-2 rounded-full px-1.5 py-0 text-[10px]">
                  {sourceLabels[detailEmployee.source] ?? detailEmployee.source}
                </span>
              )}
            </p>
          </div>
          <div className="text-content-secondary space-y-3 px-6 py-3 text-sm">
            <div>
              <span className="text-content-tertiary text-xs font-medium">Role</span>
              <p>{detailEmployee.role}</p>
            </div>
            <div>
              <span className="text-content-tertiary text-xs font-medium">Permission</span>
              <p>
                {permissionLabels[detailEmployee.permissionLevel] ?? detailEmployee.permissionLevel}
              </p>
            </div>
            <div>
              <span className="text-content-tertiary text-xs font-medium">Expertise</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {detailEmployee.expertise.map((exp) => (
                  <span
                    key={exp}
                    className="bg-surface-muted text-content-secondary rounded-full px-2 py-0.5 text-xs"
                  >
                    {exp}
                  </span>
                ))}
              </div>
            </div>
            {detailEmployee.allowedTools && detailEmployee.allowedTools.length > 0 && (
              <div>
                <span className="text-content-tertiary text-xs font-medium">Allowed Tools</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {detailEmployee.allowedTools.slice(0, 8).map((t) => (
                    <span
                      key={t}
                      className="bg-surface-muted text-content-secondary rounded px-1.5 py-0.5 text-[10px]"
                    >
                      {t}
                    </span>
                  ))}
                  {detailEmployee.allowedTools.length > 8 && (
                    <span className="text-content-tertiary text-[10px]">
                      +{detailEmployee.allowedTools.length - 8}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
            <button
              onClick={() => setDetailEmployee(null)}
              className="border-border bg-surface-primary text-content-secondary hover:bg-surface-elevated rounded-lg border px-4 py-2 text-sm"
            >
              Close
            </button>
            <button
              onClick={() => handleOpenEdit(detailEmployee)}
              className="bg-accent text-content-inverse hover:bg-accent-hover rounded-lg px-4 py-2 text-sm"
            >
              Configure
            </button>
            {detailEmployee.kind === 'ai' && (
              <button
                onClick={() => handleTest(detailEmployee.id, detailEmployee.name)}
                className="bg-intent-warning-muted text-intent-warning hover:bg-intent-warning/20 rounded-lg px-4 py-2 text-sm"
              >
                Test
              </button>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* Edit Modal */}
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
