import { useState, useEffect, useCallback } from 'react';

import { ModalOverlay } from './ModalOverlay';

import { Tabs } from '@cabinet/ui';

import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';

import { useAvailableModels } from '../hooks/useAvailableModels.js';


import { toast } from 'sonner';// ── Types ──
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

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  kind: string;
  version: number;
  status: string;
}

interface MCPServer {
  name: string;
  enabled: boolean;
  toolCount?: number;
}

interface EmployeeEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee?: EmployeeItem | null;
  activeProjectId?: string | null;
  onSaved: () => void;
}

// ── App Tool Categories ──
const APP_TOOL_CATEGORIES = [
  {
    id: 'communication',
    label: 'Communication',
    tools: ['send_email', 'fetch_rss'],
  },
  {
    id: 'browser',
    label: 'Browser',
    tools: [
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_screenshot',
      'browser_evaluate',
      'browser_read',
    ],
  },
  {
    id: 'workflow',
    label: 'Workflow Management',
    tools: ['create_workflow', 'delete_workflow'],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    tools: ['index_document', 'search_documents'],
  },
  {
    id: 'review',
    label: 'Review',
    tools: ['present_for_review'],
  },
];

const ALL_APP_TOOLS = APP_TOOL_CATEGORIES.flatMap((c) => c.tools);

// ── Helpers ──
function clamp(num: number, min: number, max: number) {
  return Math.min(Math.max(num, min), max);
}

// ── Component ──
export function EmployeeEditModal({
  isOpen,
  onClose,
  employee,
  activeProjectId,
  onSaved,
}: EmployeeEditModalProps) {
  const availableModels = useAvailableModels();
  const isCreate = !employee;
  const isAI = (form: any) => form.kind === 'ai';

  // Tabs
  const humanTabs = [{ id: 'basic', label: 'Basic Info' }];
  const [activeTab, setActiveTab] = useState('basic');

  // Form state
  const [form, setForm] = useState({
    name: '',
    kind: 'ai' as 'ai' | 'human',
    role: '',
    status: 'idle' as 'active' | 'idle' | 'offline',
    permissionLevel: 'read' as 'read' | 'write' | 'admin',
    model: 'claude-sonnet-4-6',
    temperature: 0.7,
    maxTokens: 4000,
    systemPrompt: '',
    expertise: [] as string[],
    allowedTools: [] as string[],
    source: 'custom' as string,
    external: undefined as Record<string, unknown> | undefined,
  });

  // Expertise tag input
  const [expertiseInput, setExpertiseInput] = useState('');

  // Derived
  const isExternal = (form.source ?? employee?.source ?? '').startsWith('external_');
  const aiTabs = [
    { id: 'basic', label: 'Basic Info' },
    { id: 'ai', label: 'AI Config' },
    { id: 'capabilities', label: 'Capabilities' },
    ...(isExternal ? [{ id: 'external', label: 'External' }] : []),
  ];

  // Dynamic data
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);

  // Collapsible sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    communication: true,
    browser: false,
    workflow: false,
    knowledge: false,
    review: false,
    skills: false,
    mcps: false,
  });

  // Fetch skills & MCP servers
  useEffect(() => {
    if (!isOpen) return;
    // Skills
    apiFetch('/api/skills', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setSkills(d.skills ?? []))
      .catch(() => {
        try {
          const raw = localStorage.getItem('cabinet-skills');
          if (raw) setSkills(JSON.parse(raw));
        } catch {
          /* ignore */
        }
      });
    // MCP servers
    apiFetch('/api/settings/mcp-servers', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const configs: MCPServer[] = d.configs ?? [];
        const statuses = d.servers ?? [];
        const merged = configs
          .filter((c: any) => c.enabled)
          .map((c: any) => {
            const s = statuses.find((st: any) => st.name === c.name);
            return { name: c.name, enabled: true, toolCount: s?.toolCount ?? 0 };
          });
        setMcpServers(merged);
      })
      .catch(() => setMcpServers([]));
  }, [isOpen]);

  // Reset form when employee changes
  useEffect(() => {
    if (employee) {
      const allowed = employee.allowedTools ?? [];
      setForm({
        name: employee.name,
        kind: employee.kind,
        role: employee.role,
        status: employee.status,
        permissionLevel: (employee.permissionLevel as any) ?? 'read',
        model: employee.model ?? 'claude-sonnet-4-6',
        temperature: employee.temperature ?? 0.7,
        maxTokens: employee.maxTokens ?? 4000,
        systemPrompt: employee.systemPrompt ?? '',
        expertise: [...employee.expertise],
        allowedTools: [...allowed],
        source: employee.source ?? 'custom',
        external: employee.external ?? undefined,
      });
      // Pre-expand sections that have selected tools
      const hasAppTool = (tools: string[]) => tools.some((t) => allowed.includes(t));
      setExpandedSections({
        communication: hasAppTool(APP_TOOL_CATEGORIES[0]!.tools),
        browser: hasAppTool(APP_TOOL_CATEGORIES[1]!.tools),
        workflow: hasAppTool(APP_TOOL_CATEGORIES[2]!.tools),
        knowledge: hasAppTool(APP_TOOL_CATEGORIES[3]!.tools),
        review: hasAppTool(APP_TOOL_CATEGORIES[4]!.tools),
        skills: skills.some((s) => allowed.includes(`use_skill__${s.name}`)),
        mcps: mcpServers.some((s) => allowed.includes(`mcp__${s.name}`)),
      });
    } else {
      setForm({
        name: '',
        kind: 'ai',
        role: '',
        status: 'idle',
        permissionLevel: 'read',
        model: 'claude-sonnet-4-6',
        temperature: 0.7,
        maxTokens: 4000,
        systemPrompt: '',
        expertise: [],
        allowedTools: [],
        source: 'custom',
        external: undefined,
      });
      setExpandedSections({
        communication: true,
        browser: false,
        workflow: false,
        knowledge: false,
        review: false,
        skills: false,
        mcps: false,
      });
    }
    setActiveTab('basic');
    setExpertiseInput('');
  }, [employee?.id, isOpen]);

  const toggleSection = (id: string) => {
    setExpandedSections((p) => ({ ...p, [id]: !p[id] }));
  };

  const toggleTool = (tool: string) => {
    setForm((f) => ({
      ...f,
      allowedTools: f.allowedTools.includes(tool)
        ? f.allowedTools.filter((t) => t !== tool)
        : [...f.allowedTools, tool],
    }));
  };

  const toggleAllInCategory = (tools: string[], select: boolean) => {
    setForm((f) => ({
      ...f,
      allowedTools: select
        ? Array.from(new Set([...f.allowedTools, ...tools]))
        : f.allowedTools.filter((t) => !tools.includes(t)),
    }));
  };

  const addExpertise = () => {
    const val = expertiseInput.trim();
    if (!val) return;
    setForm((f) => ({
      ...f,
      expertise: Array.from(new Set([...f.expertise, val])),
    }));
    setExpertiseInput('');
  };

  const removeExpertise = (val: string) => {
    setForm((f) => ({
      ...f,
      expertise: f.expertise.filter((e) => e !== val),
    }));
  };

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) {
      toast.warning('Name is required');
      return;
    }
    if (isCreate && !activeProjectId) {
      toast.warning('Please select a project first');
      return;
    }

    const payload: Record<string, any> = {
      name: form.name.trim(),
      role: form.role || 'advisor',
      kind: form.kind,
      permissionLevel: form.permissionLevel,
      status: form.status,
      expertise: form.expertise,
      allowedTools: form.allowedTools,
    };

    if (form.kind === 'ai') {
      payload.model = form.model;
      payload.systemPrompt = form.systemPrompt;
      payload.temperature = form.temperature;
      payload.maxTokens = form.maxTokens;
    }

    payload.source = form.source;
    if (form.external) payload.external = form.external;

    if (isCreate) {
      payload.projectId = activeProjectId;
    }

    try {
      const res = isCreate
        ? await apiFetch('/api/employees', {
            method: 'POST',
            headers: authJsonHeaders(),
            body: JSON.stringify(payload),
          })
        : await apiFetch(`/api/employees/${employee!.id}`, {
            method: 'PUT',
            headers: authJsonHeaders(),
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      toast.success(isCreate ? 'Employee created' : 'Employee updated');
      onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(isCreate ? `Failed to create: ${msg}` : `Failed to update: ${msg}`);
      console.error(err);
    }
  }, [form, isCreate, activeProjectId, employee, onSaved, onClose]);

  const tabs = form.kind === 'ai' ? aiTabs : humanTabs;

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      contentClassName="w-full max-w-lg rounded-xl border border-border bg-surface-overlay p-0 shadow-2xl overflow-hidden"
      backdropClassName="items-start justify-center pt-16"
    >
      <div className="px-6 pt-5 pb-3">
        <h2 className="text-content-primary text-lg font-semibold">
          {isCreate ? 'New Employee' : `Edit ${employee?.name}`}
        </h2>
        <p className="text-content-tertiary mt-0.5 text-xs">
          {form.kind === 'ai' ? 'AI team member' : 'Human team member'}
        </p>
      </div>

      <div className="px-6">
        <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
        {/* ── Basic Info Tab ── */}
        {activeTab === 'basic' && (
          <div className="space-y-3">
            <div>
              <label className="text-content-secondary mb-1 block text-xs font-medium">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Employee name"
                className="border-border bg-surface-primary text-content-primary placeholder:text-content-tertiary focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-content-secondary mb-1 block text-xs font-medium">
                  Kind
                </label>
                <select
                  value={form.kind}
                  onChange={(e) => {
                    const kind = e.target.value as 'ai' | 'human';
                    setForm((f) => ({ ...f, kind }));
                    if (kind === 'human') setActiveTab('basic');
                  }}
                  className="border-border bg-surface-primary text-content-primary focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                >
                  <option value="ai">AI</option>
                  <option value="human">Human</option>
                </select>
              </div>
              <div>
                <label className="text-content-secondary mb-1 block text-xs font-medium">
                  Role
                </label>
                <input
                  type="text"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  placeholder="e.g. advisor"
                  className="border-border bg-surface-primary text-content-primary placeholder:text-content-tertiary focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-content-secondary mb-1 block text-xs font-medium">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}
                  className="border-border bg-surface-primary text-content-primary focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                >
                  <option value="active">Active</option>
                  <option value="idle">Idle</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              <div>
                <label className="text-content-secondary mb-1 block text-xs font-medium">
                  Permission
                </label>
                <select
                  value={form.permissionLevel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, permissionLevel: e.target.value as any }))
                  }
                  className="border-border bg-surface-primary text-content-primary focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                >
                  <option value="read">Read</option>
                  <option value="write">Write</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {/* Expertise (shared) */}
            <div>
              <label className="text-content-secondary mb-1 block text-xs font-medium">
                Expertise
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={expertiseInput}
                  onChange={(e) => setExpertiseInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addExpertise();
                    }
                  }}
                  placeholder="Add expertise and press Enter"
                  className="border-border bg-surface-primary text-content-primary placeholder:text-content-tertiary focus:ring-accent flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
                <button
                  onClick={addExpertise}
                  className="bg-surface-muted text-content-secondary hover:bg-surface-elevated rounded-lg px-3 py-2 text-xs font-medium"
                >
                  Add
                </button>
              </div>
              {form.expertise.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {form.expertise.map((exp) => (
                    <span
                      key={exp}
                      className="bg-accent/10 text-accent inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
                    >
                      {exp}
                      <button
                        onClick={() => removeExpertise(exp)}
                        className="text-accent/60 hover:text-accent"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AI Config Tab ── */}
        {activeTab === 'ai' && form.kind === 'ai' && (
          <div className="space-y-3">
            <div>
              <label className="text-content-secondary mb-1 block text-xs font-medium">Model</label>
              <select
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                className="border-border bg-surface-primary text-content-primary focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              >
                {availableModels.length === 0 ? (
                  <option value="">No API keys configured</option>
                ) : (
                  availableModels.map(({ provider, models }) => (
                    <optgroup key={provider} label={provider}>
                      {models.map((model) => (
                        <option key={model} value={model}>
                          {model.replace(`${provider}/`, '')}
                        </option>
                      ))}
                    </optgroup>
                  ))
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-content-secondary mb-1 block text-xs font-medium">
                  Temperature{' '}
                  <span className="text-content-tertiary font-normal">({form.temperature})</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={form.temperature}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, temperature: parseFloat(e.target.value) }))
                  }
                  className="accent-accent w-full"
                />
              </div>
              <div>
                <label className="text-content-secondary mb-1 block text-xs font-medium">
                  Max Tokens
                </label>
                <input
                  type="number"
                  min="256"
                  max="32000"
                  step="256"
                  value={form.maxTokens}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxTokens: parseInt(e.target.value) || 4000 }))
                  }
                  className="border-border bg-surface-primary text-content-primary focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
            </div>

            <div>
              <label className="text-content-secondary mb-1 block text-xs font-medium">
                System Prompt
              </label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="Optional system prompt for this AI employee..."
                rows={4}
                className="border-border bg-surface-primary text-content-primary placeholder:text-content-tertiary focus:ring-accent w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
          </div>
        )}

        {/* ── Capabilities Tab ── */}
        {activeTab === 'capabilities' && form.kind === 'ai' && (
          <div className="space-y-3">
            <p className="text-content-tertiary text-xs">
              Core tools (file, memory, shell, decision read, etc.) are enabled by default. Select
              additional app-level capabilities below.
            </p>

            {/* Built-in App Tools */}
            {APP_TOOL_CATEGORIES.map((cat) => {
              const allSelected = cat.tools.every((t) => form.allowedTools.includes(t));
              const someSelected =
                cat.tools.some((t) => form.allowedTools.includes(t)) && !allSelected;
              return (
                <div key={cat.id} className="border-border rounded-lg border">
                  <button
                    onClick={() => toggleSection(cat.id)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-content-primary text-sm font-medium">{cat.label}</span>
                      {someSelected && <span className="bg-accent h-1.5 w-1.5 rounded-full" />}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAllInCategory(cat.tools, !allSelected);
                        }}
                        className="text-accent text-[10px] hover:underline"
                      >
                        {allSelected ? 'None' : 'All'}
                      </button>
                      <span className="text-content-tertiary text-xs">
                        {expandedSections[cat.id] ? '▼' : '▶'}
                      </span>
                    </div>
                  </button>
                  {expandedSections[cat.id] && (
                    <div className="border-border grid grid-cols-2 gap-2 border-t px-3 py-2">
                      {cat.tools.map((tool) => (
                        <label
                          key={tool}
                          className="text-content-secondary hover:text-content-primary flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={form.allowedTools.includes(tool)}
                            onChange={() => toggleTool(tool)}
                            className="border-border text-accent focus:ring-accent rounded"
                          />
                          <span className="text-xs">{tool}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Skills */}
            <div className="border-border rounded-lg border">
              <button
                onClick={() => toggleSection('skills')}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-content-primary text-sm font-medium">Skills</span>
                  {skills.some((s) => form.allowedTools.includes(`use_skill__${s.name}`)) && (
                    <span className="bg-accent h-1.5 w-1.5 rounded-full" />
                  )}
                </div>
                <span className="text-content-tertiary text-xs">
                  {expandedSections.skills ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.skills && (
                <div className="border-border border-t px-3 py-2">
                  {skills.length === 0 ? (
                    <p className="text-content-tertiary text-xs">No skills available.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {skills.map((skill) => {
                        const toolName = `use_skill__${skill.name}`;
                        return (
                          <label key={skill.id} className="flex cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              checked={form.allowedTools.includes(toolName)}
                              onChange={() => toggleTool(toolName)}
                              className="border-border text-accent focus:ring-accent mt-0.5 rounded"
                            />
                            <div>
                              <span className="text-content-secondary text-xs font-medium">
                                {skill.name}
                              </span>
                              <span className="text-content-tertiary ml-1 text-[10px] tracking-wider uppercase">
                                {skill.kind}
                              </span>
                              {skill.description && (
                                <p className="text-content-tertiary text-[11px]">
                                  {skill.description}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* MCP Integrations */}
            <div className="border-border rounded-lg border">
              <button
                onClick={() => toggleSection('mcps')}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-content-primary text-sm font-medium">MCP Integrations</span>
                  {mcpServers.some((s) => form.allowedTools.includes(`mcp__${s.name}`)) && (
                    <span className="bg-accent h-1.5 w-1.5 rounded-full" />
                  )}
                </div>
                <span className="text-content-tertiary text-xs">
                  {expandedSections.mcps ? '▼' : '▶'}
                </span>
              </button>
              {expandedSections.mcps && (
                <div className="border-border border-t px-3 py-2">
                  {mcpServers.length === 0 ? (
                    <p className="text-content-tertiary text-xs">
                      No MCP servers configured. Add them in Settings → MCP.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {mcpServers.map((srv) => {
                        const toolName = `mcp__${srv.name}`;
                        return (
                          <label key={srv.name} className="flex cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={form.allowedTools.includes(toolName)}
                              onChange={() => toggleTool(toolName)}
                              className="border-border text-accent focus:ring-accent rounded"
                            />
                            <span className="text-content-secondary text-xs">{srv.name}</span>
                            {srv.toolCount !== undefined && (
                              <span className="text-content-tertiary text-[10px]">
                                ({srv.toolCount} tools)
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* External Agent Tab */}
        {activeTab === 'external' && isExternal && (
          <div className="space-y-4">
            {/* Protocol */}
            <div>
              <label className="text-content-primary mb-1 block text-sm font-medium">
                Protocol
              </label>
              <div className="flex gap-4">
                <label className="text-content-secondary flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ext-protocol"
                    value="a2a"
                    checked={(form.external as any)?.protocol === 'a2a'}
                    onChange={() =>
                      setForm({ ...form, external: { ...(form.external as any), protocol: 'a2a' } })
                    }
                    className="text-accent focus:ring-accent"
                  />{' '}
                  A2A
                </label>
                <label className="text-content-secondary flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="ext-protocol"
                    value="cli"
                    checked={(form.external as any)?.protocol !== 'a2a'}
                    onChange={() =>
                      setForm({ ...form, external: { ...(form.external as any), protocol: 'cli' } })
                    }
                    className="text-accent focus:ring-accent"
                  />{' '}
                  CLI
                </label>
              </div>
            </div>
            {/* Config source */}
            <div>
              <label className="text-content-primary mb-1 block text-sm font-medium">
                Config Source
              </label>
              <select
                value={(form.external as any)?.configSource ?? 'agent_native'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    external: { ...(form.external as any), configSource: e.target.value },
                  })
                }
                className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
              >
                <option value="cabinet_managed">Cabinet-managed</option>
                <option value="agent_native">Agent-native</option>
              </select>
            </div>
            {/* CLI fields */}
            {(form.external as any)?.protocol !== 'a2a' ? (
              <>
                <div>
                  <label className="text-content-primary mb-1 block text-sm font-medium">
                    Command
                  </label>
                  <input
                    value={(form.external as any)?.command ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        external: { ...(form.external as any), command: e.target.value },
                      })
                    }
                    className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="claude"
                  />
                </div>
                <div>
                  <label className="text-content-primary mb-1 block text-sm font-medium">
                    Args
                  </label>
                  <input
                    value={(form.external as any)?.args?.join(' ') ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        external: {
                          ...(form.external as any),
                          args: e.target.value.split(' ').filter(Boolean),
                        },
                      })
                    }
                    className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="--print"
                  />
                </div>
                <div>
                  <label className="text-content-primary mb-1 block text-sm font-medium">
                    Detect Command
                  </label>
                  <input
                    value={(form.external as any)?.detectCommand ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        external: { ...(form.external as any), detectCommand: e.target.value },
                      })
                    }
                    className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="which claude"
                  />
                </div>
                <div>
                  <label className="text-content-primary mb-1 block text-sm font-medium">
                    Permission Mode
                  </label>
                  <select
                    value={(form.external as any)?.permissionMode ?? 'auto'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        external: { ...(form.external as any), permissionMode: e.target.value },
                      })
                    }
                    className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="auto">auto</option>
                    <option value="conservative">conservative</option>
                    <option value="default">default</option>
                    <option value="plan">plan</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="text-content-primary mb-1 block text-sm font-medium">
                    Base URL
                  </label>
                  <input
                    value={(form.external as any)?.baseUrl ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        external: { ...(form.external as any), baseUrl: e.target.value },
                      })
                    }
                    className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="http://localhost:3002"
                  />
                </div>
                <div>
                  <label className="text-content-primary mb-1 block text-sm font-medium">
                    Health Check URL
                  </label>
                  <input
                    value={(form.external as any)?.healthCheckUrl ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        external: { ...(form.external as any), healthCheckUrl: e.target.value },
                      })
                    }
                    className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="http://localhost:3002/health"
                  />
                </div>
              </>
            )}
            {/* Common */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-content-primary mb-1 block text-sm font-medium">
                  Timeout (ms)
                </label>
                <input
                  type="number"
                  value={(form.external as any)?.timeoutMs ?? 120000}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      external: { ...(form.external as any), timeoutMs: parseInt(e.target.value) },
                    })
                  }
                  className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-content-primary mb-1 block text-sm font-medium">
                  Max Retries
                </label>
                <input
                  type="number"
                  value={(form.external as any)?.maxRetries ?? 2}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      external: { ...(form.external as any), maxRetries: parseInt(e.target.value) },
                    })
                  }
                  className="border-border bg-surface-primary text-content-primary w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
        <button
          onClick={onClose}
          className="border-border bg-surface-primary text-content-secondary hover:bg-surface-elevated rounded-lg border px-4 py-2 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!form.name.trim()}
          className="bg-accent text-content-inverse hover:bg-accent-hover rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          {isCreate ? 'Create Employee' : 'Save Changes'}
        </button>
      </div>
    </ModalOverlay>
  );
}
