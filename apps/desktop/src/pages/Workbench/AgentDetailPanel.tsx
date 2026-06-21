import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authJsonHeaders } from '../../utils/api.js';
import { useToast } from '../../components/Toast.js';

interface AgentDetail {
  name: string;
  description: string;
  external_config: string;
}

interface McpBinding {
  id: string;
  mcp_server_name: string;
  enabled: number;
}

interface SkillBinding {
  id: string;
  skill_name: string;
  enabled: number;
}

interface McpServer {
  name: string;
  enabled: boolean;
}

interface SkillItem {
  id: string;
  name: string;
}

export function AgentDetailPanel({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { addToast } = useToast();
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [mcpBindings, setMcpBindings] = useState<McpBinding[]>([]);
  const [skillBindings, setSkillBindings] = useState<SkillBinding[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<SkillItem[]>([]);

  const fetchAll = useCallback(async () => {
    try {
      const d = (await (
        await apiFetch(`/api/workbench/agents/${encodeURIComponent(agentId)}`)
      ).json()) as {
        agent: AgentDetail & { mcpBindings: McpBinding[]; skillBindings: SkillBinding[] };
      };
      setDetail(d.agent);
      setMcpBindings(d.agent.mcpBindings ?? []);
      setSkillBindings(d.agent.skillBindings ?? []);
    } catch {
      setDetail(null);
    }
    try {
      const m = (await (await apiFetch('/api/settings/mcp-servers')).json()) as {
        servers: McpServer[];
      };
      setMcpServers(m.servers ?? []);
    } catch {
      /* ok */
    }
    try {
      const s = (await (await apiFetch('/api/skills')).json()) as { skills: SkillItem[] };
      setSkills(s.skills ?? []);
    } catch {
      /* ok */
    }
  }, [agentId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const toggleMcp = async (serverName: string, enable: boolean) => {
    await apiFetch(`/api/workbench/bindings/${encodeURIComponent(agentId)}/mcp`, {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify({ serverName, enabled: enable }),
    });
    await fetchAll();
  };

  const toggleSkill = async (skillName: string, enable: boolean) => {
    await apiFetch(`/api/workbench/bindings/${encodeURIComponent(agentId)}/skill`, {
      method: 'PUT',
      headers: authJsonHeaders(),
      body: JSON.stringify({ skillName, enabled: enable }),
    });
    await fetchAll();
  };

  const projectNow = async () => {
    try {
      const res = await apiFetch(
        `/api/workbench/agents/${encodeURIComponent(agentId)}/project?dryRun=0`,
        { method: 'POST' },
      );
      const data = (await res.json()) as { status: string };
      addToast(
        data.status === 'projected' ? 'success' : 'error',
        data.status === 'projected' ? 'Config projected' : 'Project failed',
      );
    } catch {
      addToast('error', 'Project failed');
    }
  };

  if (!detail)
    return <div className="w-80 border-l border-[var(--border-color)] p-4">Loading\u2026</div>;
  const external = (() => {
    try {
      return JSON.parse(detail.external_config ?? '{}');
    } catch {
      return {};
    }
  })();

  return (
    <div className="w-96 overflow-y-auto border-l border-[var(--border-color)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{detail.name}</h2>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-primary text-sm"
        >
          &times;
        </button>
      </div>
      <div className="text-content-secondary mb-4 space-y-2 text-sm">
        <div>
          Command:{' '}
          <code className="bg-surface-muted rounded px-1">{external.command ?? 'N/A'}</code>
        </div>
        <div>
          Protocol:{' '}
          <span className="bg-accent-muted text-accent rounded px-1">
            {external.dispatchProtocol ?? external.protocol ?? 'cli'}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold">API Keys (from Key Vault)</h3>
        <p className="text-content-tertiary text-xs">
          Managed in <strong>API Keys</strong> tab.
        </p>
      </div>

      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold">MCP Servers</h3>
        {mcpServers.length === 0 ? (
          <p className="text-content-tertiary text-xs">No MCP servers configured.</p>
        ) : (
          <div className="space-y-1">
            {mcpServers.map((s) => {
              const binding = mcpBindings.find((b) => b.mcp_server_name === s.name);
              const enabled = binding ? binding.enabled === 1 : false;
              return (
                <label key={s.name} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleMcp(s.name, e.target.checked)}
                  />
                  {s.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold">Skills</h3>
        {skills.length === 0 ? (
          <p className="text-content-tertiary text-xs">No skills configured.</p>
        ) : (
          <div className="space-y-1">
            {skills.map((s) => {
              const binding = skillBindings.find((b) => b.skill_name === s.name);
              const enabled = binding ? binding.enabled === 1 : false;
              return (
                <label key={s.name} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleSkill(s.name, e.target.checked)}
                  />
                  {s.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={projectNow}
          className="bg-accent text-accent-foreground flex-1 rounded-md px-3 py-1.5 text-sm"
        >
          Project config now
        </button>
      </div>
    </div>
  );
}
