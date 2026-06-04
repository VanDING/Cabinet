//
// AgentManagerPage — lists all registered agents with status, capabilities,
// and quick actions (open terminal, assign task, view telemetry, configure).
//

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api.js';

// ── Types ────────────────────────────────────────────────────────

interface AgentEntry {
  id: string;
  name: string;
  type: string;
  description: string;
  status: 'online' | 'offline' | 'busy';
  configSource: 'cabinet_managed' | 'agent_native';
  capabilities: string[];
  external?: {
    protocol: 'a2a' | 'cli';
    baseUrl?: string;
    command?: string;
  };
  stats?: {
    tasksCompleted: number;
    totalTokens: number;
    avgTtftMs: number;
  };
}

// ── Component ────────────────────────────────────────────────────

export const AgentManagerPage: React.FC = () => {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentEntry | null>(null);
  const [showShell, setShowShell] = useState(false);
  const [configDraft, setConfigDraft] = useState<Record<string, string>>({});

  // ── Fetch agents ──────────────────────────────────────────────

  const fetchAgents = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/agents');
      const data = await resp.json() as { agents?: AgentEntry[] };
      const list = (data.agents ?? []).map((a: AgentEntry) => ({
        ...a,
        status: a.status ?? 'offline',
        capabilities: a.capabilities ?? [],
        stats: a.stats ?? { tasksCompleted: 0, totalTokens: 0, avgTtftMs: 0 },
      }));
      setAgents(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // ── Actions ───────────────────────────────────────────────────

  const handleOpenShell = (agent: AgentEntry) => {
    setSelectedAgent(agent);
    setShowShell(true);
  };

  const handleToggleEnabled = async (agent: AgentEntry) => {
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: agent.status !== 'offline' ? false : true }),
      });
      fetchAgents();
    } catch {
      /* noop */
    }
  };

  const handleSaveConfig = async (agent: AgentEntry) => {
    try {
      await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external: configDraft }),
      });
      setSelectedAgent(null);
      setConfigDraft({});
      fetchAgents();
    } catch {
      /* noop */
    }
  };

  // ── Status badge ──────────────────────────────────────────────

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      online: 'bg-green-600/20 text-green-400',
      offline: 'bg-gray-600/20 text-gray-400',
      busy: 'bg-yellow-600/20 text-yellow-400',
    };
    const icons: Record<string, string> = { online: '●', offline: '○', busy: '◐' };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${colors[status] ?? colors.offline}`}>
        {icons[status] ?? '○'} {status}
      </span>
    );
  };

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      builtin: 'bg-blue-600/20 text-blue-400',
      custom: 'bg-purple-600/20 text-purple-400',
      external_a2a: 'bg-teal-600/20 text-teal-400',
      external_cli: 'bg-amber-600/20 text-amber-400',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs ${colors[type] ?? 'bg-gray-600/20 text-gray-400'}`}>
        {type}
      </span>
    );
  };

  // ── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-content-tertiary">
        Loading agents...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-content-primary">Agent Management</h1>
        <button
          className="px-4 py-2 bg-accent-blue text-white rounded-lg hover:bg-accent-blue/90 text-sm"
          onClick={() => fetchAgents()}
        >
          + Register Agent
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-600/10 border border-red-600/30 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Agent list */}
      <div className="space-y-3">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="bg-surface-elevated border border-divider rounded-lg p-4 hover:border-accent-blue/30 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-content-primary">{agent.name}</span>
                  {statusBadge(agent.status)}
                  {typeBadge(agent.type)}
                  {agent.configSource === 'cabinet_managed' && (
                    <span className="text-xs text-content-tertiary">🔑 Cabinet-managed</span>
                  )}
                  {agent.configSource === 'agent_native' && (
                    <span className="text-xs text-content-tertiary">🔐 Agent-native config</span>
                  )}
                </div>
                <p className="text-sm text-content-secondary mb-2">{agent.description}</p>

                {/* Capabilities */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {agent.capabilities.map((cap) => (
                    <span key={cap} className="px-2 py-0.5 bg-surface-dark rounded text-xs text-content-tertiary">
                      {cap}
                    </span>
                  ))}
                </div>

                {/* Stats */}
                {agent.stats && agent.stats.tasksCompleted > 0 && (
                  <div className="flex gap-4 text-xs text-content-tertiary">
                    <span>📊 {agent.stats.tasksCompleted} tasks</span>
                    <span>🪙 {(agent.stats.totalTokens / 1000).toFixed(1)}k tokens</span>
                    <span>⚡ {agent.stats.avgTtftMs}ms avg TTFT</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 ml-4">
                {agent.type === 'external_cli' && (
                  <button
                    className="px-2 py-1 text-xs bg-surface-dark hover:bg-accent-blue/20 rounded transition-colors"
                    onClick={() => handleOpenShell(agent)}
                    title="Open terminal"
                  >
                    💻 Open Terminal
                  </button>
                )}
                <button
                  className="px-2 py-1 text-xs bg-surface-dark hover:bg-surface-dark/80 rounded transition-colors"
                  onClick={() => { setSelectedAgent(agent); setConfigDraft(agent.external as any ?? {}); }}
                  title="Configure"
                >
                  ⚙️ Configure
                </button>
                <button
                  className="px-2 py-1 text-xs bg-surface-dark hover:bg-surface-dark/80 rounded transition-colors"
                  title="View telemetry"
                >
                  📈 Telemetry
                </button>
                <button
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    agent.status !== 'offline'
                      ? 'bg-red-600/10 hover:bg-red-600/20 text-red-400'
                      : 'bg-green-600/10 hover:bg-green-600/20 text-green-400'
                  }`}
                  onClick={() => handleToggleEnabled(agent)}
                >
                  {agent.status !== 'offline' ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>

            {/* External info */}
            {agent.external && (
              <div className="mt-2 pt-2 border-t border-divider text-xs text-content-tertiary">
                Protocol: {agent.external.protocol}
                {agent.external.baseUrl && <> | Endpoint: {agent.external.baseUrl}</>}
                {agent.external.command && <> | Command: {agent.external.command}</>}
              </div>
            )}
          </div>
        ))}

        {agents.length === 0 && !loading && (
          <div className="text-center py-12 text-content-tertiary">
            <p className="text-lg mb-2">No agents registered</p>
            <p className="text-sm">Click "Register Agent" to add your first external agent.</p>
          </div>
        )}
      </div>

      {/* Configuration modal */}
      {selectedAgent && !showShell && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-elevated border border-divider rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Configure: {selectedAgent.name}</h2>
            <div className="space-y-3">
              {Object.entries(configDraft).map(([key, value]) => (
                <div key={key}>
                  <label className="block text-xs text-content-tertiary mb-1">{key}</label>
                  <input
                    className="w-full bg-surface-dark border border-divider rounded px-3 py-1.5 text-sm text-content-primary"
                    value={String(value ?? '')}
                    onChange={(e) => setConfigDraft({ ...configDraft, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1.5 text-sm text-content-tertiary hover:text-content-primary"
                onClick={() => setSelectedAgent(null)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-sm bg-accent-blue text-white rounded"
                onClick={() => handleSaveConfig(selectedAgent)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentManagerPage;
