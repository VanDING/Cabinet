import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/api.js';
import { useToast } from '../components/Toast';

interface McpServer {
  name: string;
  enabled: boolean;
  status: 'connected' | 'disconnected';
  toolCount: number;
}

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  kind: string;
  status: string;
}

interface AgentInfo {
  id: string;
  name: string;
  source: string;
}

interface McpBinding {
  id: string;
  agentType: string;
  serverName: string;
  enabled: boolean;
}

interface SkillBinding {
  id: string;
  agentType: string;
  skillName: string;
  enabled: boolean;
}

type Tab = 'apikeys' | 'mcp' | 'skills' | 'bindings';

export function WorkbenchContent({ embedded = false }: { embedded?: boolean } = {}) {
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>('bindings');

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'bindings', label: 'Agent Bindings' },
    { id: 'mcp', label: 'MCP Servers' },
    { id: 'skills', label: 'Skills' },
    { id: 'apikeys', label: 'API Keys' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-color)] px-6 pt-4">
        {!embedded && (
          <>
            <h1 className="text-content-primary text-lg font-bold">Workbench</h1>
            <p className="text-content-tertiary mb-3 text-sm">
              Unified management for API keys, MCP servers, skills, and agent bindings.
            </p>
          </>
        )}
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-content-tertiary hover:text-content-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'bindings' && <BindingsTab />}
        {tab === 'mcp' && <McpTab />}
        {tab === 'skills' && <SkillsTab />}
        {tab === 'apikeys' && <ApiKeysTab />}
      </div>
    </div>
  );
}

function BindingsTab() {
  const { addToast } = useToast();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcpBindings, setMcpBindings] = useState<Map<string, boolean>>(new Map());
  const [skillBindings, setSkillBindings] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await apiFetch('/api/employees', { headers: authHeaders() });
      const data = await res.json();
      const all = (data.employees ?? []).filter((e: { kind: string }) => e.kind === 'ai');
      setAgents(all);
      if (all.length > 0 && !selectedAgent) setSelectedAgent(all[0].id);
    } catch {
      setAgents([]);
    }
  }, [selectedAgent]);

  const fetchMcpServers = useCallback(async () => {
    try {
      const res = await apiFetch('/api/settings/mcp-servers', { headers: authHeaders() });
      const data = await res.json();
      setMcpServers(
        (data.servers ?? []).map((s: any) => ({
          name: s.name,
          enabled: s.enabled,
          status: s.status,
          toolCount: s.toolCount ?? 0,
        })),
      );
    } catch {
      setMcpServers([]);
    }
  }, []);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await apiFetch('/api/skills', { headers: authHeaders() });
      const data = await res.json();
      setSkills(data.skills ?? []);
    } catch {
      setSkills([]);
    }
  }, []);

  const fetchBindings = useCallback(async (agentType: string) => {
    try {
      const res = await apiFetch(`/api/workbench/bindings/${encodeURIComponent(agentType)}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      const mcpMap = new Map<string, boolean>();
      (data.mcpBindings ?? []).forEach((b: { serverName: string; enabled: boolean }) => {
        mcpMap.set(b.serverName, b.enabled);
      });
      setMcpBindings(mcpMap);
      const skillMap = new Map<string, boolean>();
      (data.skillBindings ?? []).forEach((b: { skillName: string; enabled: boolean }) => {
        skillMap.set(b.skillName, b.enabled);
      });
      setSkillBindings(skillMap);
    } catch {
      setMcpBindings(new Map());
      setSkillBindings(new Map());
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchAgents(), fetchMcpServers(), fetchSkills()]).then(() => setLoading(false));
  }, [fetchAgents, fetchMcpServers, fetchSkills]);

  useEffect(() => {
    if (selectedAgent) fetchBindings(selectedAgent);
  }, [selectedAgent, fetchBindings]);

  const toggleMcpBinding = async (serverName: string, enabled: boolean) => {
    if (!selectedAgent) return;
    setMcpBindings((prev) => new Map(prev).set(serverName, enabled));
    try {
      await apiFetch(`/api/workbench/bindings/${encodeURIComponent(selectedAgent)}/mcp`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ serverName, enabled }),
      });
    } catch {
      addToast('error', 'Failed to update MCP binding');
      setMcpBindings((prev) => new Map(prev).set(serverName, !enabled));
    }
  };

  const toggleSkillBinding = async (skillName: string, enabled: boolean) => {
    if (!selectedAgent) return;
    setSkillBindings((prev) => new Map(prev).set(skillName, enabled));
    try {
      await apiFetch(`/api/workbench/bindings/${encodeURIComponent(selectedAgent)}/skill`, {
        method: 'PUT',
        headers: authJsonHeaders(),
        body: JSON.stringify({ skillName, enabled }),
      });
    } catch {
      addToast('error', 'Failed to update skill binding');
      setSkillBindings((prev) => new Map(prev).set(skillName, !enabled));
    }
  };

  if (loading) return <div className="text-content-tertiary text-center text-sm">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Agent selector */}
      <div>
        <label className="text-content-secondary mb-2 block text-xs font-semibold">Select Agent</label>
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelectedAgent(agent.id)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                selectedAgent === agent.id
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'border-border bg-surface-elevated text-content-secondary hover:bg-surface-muted'
              }`}
            >
              {agent.name}
              <span className="text-content-tertiary ml-1.5 text-xs">({agent.source})</span>
            </button>
          ))}
        </div>
      </div>

      {selectedAgent && (
        <>
          {/* MCP Server bindings */}
          <div>
            <h3 className="text-content-secondary mb-2 text-sm font-semibold">
              MCP Server Bindings
            </h3>
            {mcpServers.length === 0 ? (
              <p className="text-content-tertiary text-xs">No MCP servers configured.</p>
            ) : (
              <div className="space-y-1">
                {mcpServers.map((server) => {
                  const bound = mcpBindings.get(server.name) ?? false;
                  return (
                    <div
                      key={server.name}
                      className="border-border bg-surface-elevated flex items-center justify-between rounded-lg border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            server.status === 'connected'
                              ? 'bg-intent-success'
                              : 'bg-content-tertiary'
                          }`}
                        />
                        <span className="text-content-primary text-sm font-medium">
                          {server.name}
                        </span>
                        <span className="text-content-tertiary text-xs">
                          {server.toolCount} tools
                        </span>
                      </div>
                      <button
                        onClick={() => toggleMcpBinding(server.name, !bound)}
                        className={`relative h-5 w-9 rounded-full transition-colors ${
                          bound ? 'bg-accent' : 'bg-surface-muted'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                            bound ? 'left-4' : 'left-0.5'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Skill bindings */}
          <div>
            <h3 className="text-content-secondary mb-2 text-sm font-semibold">Skill Bindings</h3>
            {skills.length === 0 ? (
              <p className="text-content-tertiary text-xs">No skills available.</p>
            ) : (
              <div className="space-y-1">
                {skills.map((skill) => {
                  const bound = skillBindings.get(skill.name) ?? false;
                  return (
                    <div
                      key={skill.id}
                      className="border-border bg-surface-elevated flex items-center justify-between rounded-lg border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-content-primary text-sm font-medium">
                          {skill.name}
                        </span>
                        <span className="text-content-tertiary text-xs">{skill.kind}</span>
                      </div>
                      <button
                        onClick={() => toggleSkillBinding(skill.name, !bound)}
                        className={`relative h-5 w-9 rounded-full transition-colors ${
                          bound ? 'bg-accent' : 'bg-surface-muted'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                            bound ? 'left-4' : 'left-0.5'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function McpTab() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/settings/mcp-servers', { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        setServers(
          (data.servers ?? []).map((s: any) => ({
            name: s.name,
            enabled: s.enabled,
            status: s.status,
            toolCount: s.toolCount ?? 0,
          })),
        );
      })
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-content-tertiary text-center text-sm">Loading...</div>;

  return (
    <div className="space-y-3">
      <p className="text-content-tertiary text-sm">
        MCP servers are managed in Settings → Discovery → MCP. Here's the current status:
      </p>
      {servers.length === 0 ? (
        <p className="text-content-tertiary text-sm">No MCP servers configured.</p>
      ) : (
        servers.map((server) => (
          <div
            key={server.name}
            className="border-border bg-surface-elevated flex items-center justify-between rounded-lg border p-3"
          >
            <div>
              <div className="text-content-primary text-sm font-medium">{server.name}</div>
              <div className="text-content-tertiary text-xs">
                {server.toolCount} tools · {server.status}
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                server.enabled
                  ? 'bg-intent-success-muted text-intent-success'
                  : 'bg-surface-muted text-content-tertiary'
              }`}
            >
              {server.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function SkillsTab() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/skills', { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => setSkills(data.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-content-tertiary text-center text-sm">Loading...</div>;

  return (
    <div className="space-y-3">
      <p className="text-content-tertiary text-sm">
        Skills are managed in Discovery → Skills. Here's the current list:
      </p>
      {skills.length === 0 ? (
        <p className="text-content-tertiary text-sm">No skills available.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-1 md:grid-cols-2">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="border-border bg-surface-elevated rounded-lg border p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-content-primary text-sm font-medium">{skill.name}</span>
                <span className="bg-surface-muted text-content-tertiary rounded px-1.5 py-0.5 text-xs">
                  {skill.kind}
                </span>
              </div>
              {skill.description && (
                <p className="text-content-tertiary mt-1 text-xs">{skill.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApiKeysTab() {
  const [keys, setKeys] = useState<
    Array<{ id: string; provider: string; keyPreview: string; model?: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/settings/api-keys', { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => setKeys(data.keys ?? []))
      .catch(() => setKeys([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-content-tertiary text-center text-sm">Loading...</div>;

  return (
    <div className="space-y-3">
      <p className="text-content-tertiary text-sm">
        API keys are managed in Settings → API Keys. Here's the current list:
      </p>
      {keys.length === 0 ? (
        <p className="text-content-tertiary text-sm">No API keys configured.</p>
      ) : (
        keys.map((key) => (
          <div
            key={key.id}
            className="border-border bg-surface-elevated flex items-center justify-between rounded-lg border p-3"
          >
            <div>
              <div className="text-content-primary text-sm font-medium">{key.provider}</div>
              {key.model && (
                <div className="text-content-tertiary text-xs font-mono">{key.model}</div>
              )}
            </div>
            <span className="text-content-tertiary font-mono text-xs">{key.keyPreview}...</span>
          </div>
        ))
      )}
    </div>
  );
}

export function WorkbenchPage() {
  return <WorkbenchContent />;
}
