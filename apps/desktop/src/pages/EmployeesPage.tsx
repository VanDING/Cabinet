import { useState, useEffect, useMemo } from 'react';
import { Search, Settings, Zap, Trash2, X, Plus } from 'lucide-react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import { useToast } from '../components/Toast.js';
import { EmployeeEditModal } from '../components/EmployeeEditModal.js';
import { ModalOverlay } from '../components/ModalOverlay.js';

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
type SourceFilter = 'all' | 'builtin' | 'custom' | 'external_cli' | 'external_a2a';

export function EmployeesPage({ activeProjectId }: { activeProjectId?: string | null }) {
  const { addToast } = useToast();
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeItem | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<EmployeeItem | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [scanning, setScanning] = useState(false);

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
      .catch((err) => { console.warn('Operation failed', err); });
  };

  const filtered = useMemo(() => {
    let result = employees;
    if (kindFilter !== 'all') {
      result = result.filter((e) => e.kind === kindFilter);
    }
    if (sourceFilter !== 'all') {
      result = result.filter((e) => e.source === sourceFilter);
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
  }, [employees, kindFilter, sourceFilter, searchQuery]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await apiFetch('/api/agents/scan', { method: 'POST', headers: authJsonHeaders() });
      const data = await res.json() as {
        discovered: Array<{
          name: string;
          command: string;
          installed: boolean;
          version?: string;
          registered: boolean;
        }>;
      };
      const unregistered = data.discovered.filter((d) => d.installed && !d.registered);
      if (unregistered.length > 0) {
        for (const agent of unregistered) {
          const id = `emp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          await apiFetch('/api/employees', {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify({
              id,
              name: agent.name,
              role: agent.command,
              kind: 'ai',
              projectId: activeProjectId ?? 'default',
              permissionLevel: 'write',
              expertise: [],
              source: 'external_cli',
              external: {
                protocol: 'cli',
                configSource: 'agent_native',
                command: agent.command,
                args: ['--print'],
                detectCommand: `which ${agent.command}`,
              },
            }),
          });
        }
        addToast?.('success', 'Registered ' + unregistered.length + ' CLI agent(s)');
        refreshEmployees();
      } else {
        addToast?.('info', 'All installed agents are already registered');
      }
    } catch (err) {
      addToast?.('error', 'Scan failed: ' + String(err));
    } finally {
      setScanning(false);
      setAddMenuOpen(false);
    }
  };

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

  const handleOpenEdit = (emp: EmployeeItem) => {
    setEditingEmployee(emp);
    setModalOpen(true);
    setDetailEmployee(null);
  };

  const handleSaved = () => {
    refreshEmployees();
  };

  const sourceLabels: Record<string, string> = {
    builtin: '内置',
    custom: '自定义',
    external_cli: 'CLI',
    external_a2a: 'A2A',
  };

  const sourceBadgeClass: Record<string, string> = {
    builtin: 'bg-blue-600/15 text-blue-400',
    custom: 'bg-purple-600/15 text-purple-400',
    external_cli: 'bg-amber-600/15 text-amber-400',
    external_a2a: 'bg-teal-600/15 text-teal-400',
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
          <h1 className="text-2xl font-bold text-content-primary">Employees</h1>
          <span className="text-sm text-content-tertiary">
            Configure AI and human team members
          </span>
        </div>
        <div className="relative">
          <button
            onClick={() => setAddMenuOpen(!addMenuOpen)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-content-inverse hover:bg-accent-hover"
          >
            <Plus size={16} />
            Add
          </button>
          {addMenuOpen && (
            <div
              className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-surface-primary py-1 shadow-xl"
              onClick={() => setAddMenuOpen(false)}
            >
              <button
                className="w-full px-3 py-2 text-left text-sm text-content-secondary hover:bg-surface-muted"
                onClick={() => {
                  setAddMenuOpen(false);
                  handleOpenCreate();
                }}
              >
                Add Human Employee
              </button>
              <button
                className="w-full px-3 py-2 text-left text-sm text-content-secondary hover:bg-surface-muted"
                onClick={() => {
                  setAddMenuOpen(false);
                  handleOpenCreate();
                }}
              >
                Add Custom AI Agent
              </button>
              <div className="my-1 border-t border-border" />
              <button
                className="w-full px-3 py-2 text-left text-sm text-content-secondary hover:bg-surface-muted disabled:opacity-50"
                onClick={handleScan}
                disabled={scanning}
              >
                {scanning ? 'Scanning…' : 'Scan for CLI Agents'}
              </button>
              <button
                className="w-full px-3 py-2 text-left text-sm text-content-secondary hover:bg-surface-muted"
                onClick={() => {
                  setAddMenuOpen(false);
                  handleOpenCreate();
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
          onClick={() => { setKindFilter('all'); setSourceFilter('all'); }}
          className={filterButtonClass(kindFilter === 'all' && sourceFilter === 'all')}
        >
          全部
        </button>
        <button onClick={() => { setKindFilter('ai'); setSourceFilter('all'); }} className={filterButtonClass(kindFilter === 'ai')}>
          AI
        </button>
        <button onClick={() => { setKindFilter('human'); setSourceFilter('all'); }} className={filterButtonClass(kindFilter === 'human')}>
          Human
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => { setKindFilter('all'); setSourceFilter('builtin'); }} className={filterButtonClass(sourceFilter === 'builtin')}>
          内置
        </button>
        <button onClick={() => { setKindFilter('all'); setSourceFilter('custom'); }} className={filterButtonClass(sourceFilter === 'custom')}>
          自定义
        </button>
        <button onClick={() => { setKindFilter('all'); setSourceFilter('external_cli'); }} className={filterButtonClass(sourceFilter === 'external_cli')}>
          CLI
        </button>
        <button onClick={() => { setKindFilter('all'); setSourceFilter('external_a2a'); }} className={filterButtonClass(sourceFilter === 'external_a2a')}>
          A2A
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Search size={14} className="text-content-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-40 rounded-lg border border-border bg-surface-primary px-3 py-1 text-xs text-content-primary placeholder:text-content-tertiary focus:outline-hidden focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      <div className="mb-4 text-sm text-content-tertiary">
        {filtered.length} team members
      </div>

      {loading && employees.length === 0 && (
        <div className="flex h-64 items-center justify-center">
          <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-content-tertiary">No employees match the filter.</p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((emp) => (
          <div
            key={emp.id}
            onClick={() => setDetailEmployee(emp)}
            className="group relative cursor-pointer rounded-xl border border-border bg-surface-primary p-4 shadow-xs transition-all hover:shadow-md"
          >
            {/* Top row: status dot + name | source badge */}
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass[emp.status]}`}
                  title={emp.status}
                />
                <h3 className="truncate text-sm font-semibold text-content-primary">{emp.name}</h3>
              </div>
              {emp.source && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    sourceBadgeClass[emp.source] ?? 'bg-surface-muted text-content-secondary'
                  }`}
                >
                  {sourceLabels[emp.source] ?? emp.source}
                </span>
              )}
            </div>

            {/* Kind + model / role */}
            <p className="mb-3 text-xs text-content-tertiary">
              {emp.kind === 'ai' ? `AI · ${emp.model || 'Unknown model'}` : `Human · ${emp.role}`}
            </p>

            {/* Expertise tags */}
            <div className="mb-3 flex flex-wrap gap-1">
              {emp.expertise.slice(0, 3).map((exp) => (
                <span
                  key={exp}
                  className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-content-secondary"
                >
                  {exp}
                </span>
              ))}
              {emp.expertise.length > 3 && (
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] text-content-tertiary">
                  +{emp.expertise.length - 3}
                </span>
              )}
            </div>

            {/* Permission + actions */}
            <div className="flex items-center justify-between">
              <span className="rounded-sm bg-surface-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-content-tertiary">
                {permissionLabels[emp.permissionLevel] ?? emp.permissionLevel}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEdit(emp);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-content-secondary hover:bg-surface-elevated"
                >
                  <Settings size={10} />
                  配置
                </button>
                {emp.kind === 'ai' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addToast('info', `Test ${emp.name} — placeholder`);
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-intent-warning-muted px-2 py-1 text-[10px] text-intent-warning hover:bg-intent-warning/20"
                  >
                    <Zap size={10} />
                    测试
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(emp.id);
                  }}
                  className="inline-flex items-center rounded-md p-1 text-content-tertiary opacity-0 transition-opacity hover:text-intent-danger group-hover:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
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
              <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass[detailEmployee.status]}`} />
              <h2 className="text-lg font-semibold text-content-primary">{detailEmployee.name}</h2>
            </div>
            <p className="mt-0.5 text-xs text-content-tertiary">
              {detailEmployee.kind === 'ai'
                ? `AI · ${detailEmployee.model || 'Unknown model'}`
                : `Human · ${detailEmployee.role}`}
              {detailEmployee.source && (
                <span className="ml-2 rounded-full bg-surface-muted px-1.5 py-0 text-[10px]">
                  {sourceLabels[detailEmployee.source] ?? detailEmployee.source}
                </span>
              )}
            </p>
          </div>
          <div className="px-6 py-3 space-y-3 text-sm text-content-secondary">
            <div>
              <span className="text-xs font-medium text-content-tertiary">Role</span>
              <p>{detailEmployee.role}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-content-tertiary">Permission</span>
              <p>{permissionLabels[detailEmployee.permissionLevel] ?? detailEmployee.permissionLevel}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-content-tertiary">Expertise</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {detailEmployee.expertise.map((exp) => (
                  <span key={exp} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-content-secondary">
                    {exp}
                  </span>
                ))}
              </div>
            </div>
            {detailEmployee.allowedTools && detailEmployee.allowedTools.length > 0 && (
              <div>
                <span className="text-xs font-medium text-content-tertiary">Allowed Tools</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {detailEmployee.allowedTools.slice(0, 8).map((t) => (
                    <span key={t} className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-content-secondary">
                      {t}
                    </span>
                  ))}
                  {detailEmployee.allowedTools.length > 8 && (
                    <span className="text-[10px] text-content-tertiary">+{detailEmployee.allowedTools.length - 8}</span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            <button
              onClick={() => setDetailEmployee(null)}
              className="rounded-lg border border-border bg-surface-primary px-4 py-2 text-sm text-content-secondary hover:bg-surface-elevated"
            >
              Close
            </button>
            <button
              onClick={() => handleOpenEdit(detailEmployee)}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-content-inverse hover:bg-accent-hover"
            >
              Configure
            </button>
            {detailEmployee.kind === 'ai' && (
              <button
                onClick={() => addToast('info', `Test ${detailEmployee.name} — placeholder`)}
                className="rounded-lg bg-intent-warning-muted px-4 py-2 text-sm text-intent-warning hover:bg-intent-warning/20"
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
