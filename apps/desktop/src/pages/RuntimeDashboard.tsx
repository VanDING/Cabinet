//
// RuntimeDashboard — Agent telemetry and performance overview.
//
// Shows per-agent stats: tasks, success rate, tokens, TTFT, TPS, tool latency.
// Subscribes to WebSocket agent_event for live updates.
//

import React, { useState, useEffect, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────

interface AgentStats {
  agent_id: string;
  total_tasks: number;
  completed: number;
  failed: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  avg_ttft_ms: number;
  avg_total_ms: number;
  last_active: string | null;
}

// ── Component ────────────────────────────────────────────────────

export const RuntimeDashboard: React.FC = () => {
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // ── Fetch initial stats ──────────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const resp = await fetch('/api/telemetry/stats');
      if (resp.ok) {
        const data = await resp.json() as { stats: AgentStats[] };
        setStats(data.stats ?? []);
      }
    } catch { /* non-critical */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ── WebSocket live updates ───────────────────────────────────

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', channel: 'agent_event' }));

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'agent_event' || data.type === 'telemetry') {
          fetchStats(); // Refresh on new event
        }
      } catch { /* ignore */ }
    };

    return () => ws.close();
  }, [fetchStats]);

  // ── Derived metrics ──────────────────────────────────────────

  const selectedStats = selectedAgent
    ? stats.find((s) => s.agent_id === selectedAgent) ?? null
    : null;

  const totalTasks = stats.reduce((sum, s) => sum + s.total_tasks, 0);
  const totalTokens = stats.reduce((sum, s) => sum + s.total_prompt_tokens + s.total_completion_tokens, 0);
  const overallSuccess = totalTasks > 0
    ? Math.round((stats.reduce((sum, s) => sum + s.completed, 0) / totalTasks) * 100)
    : 100;

  // ── Render ────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-full text-content-tertiary">Loading telemetry...</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-2xl font-bold text-content-primary mb-6">Runtime Dashboard</h1>

      {/* Overview cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <MetricCard label="Total Tasks" value={totalTasks.toLocaleString()} color="blue" />
        <MetricCard label="Success Rate" value={`${overallSuccess}%`} color="green" />
        <MetricCard label="Total Tokens" value={formatTokens(totalTokens)} color="purple" />
        <MetricCard label="Agents Active" value={stats.filter((s) => s.total_tasks > 0).length.toString()} color="amber" />
      </div>

      {/* Agent table */}
      <div className="bg-surface-elevated border border-divider rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-dark">
            <tr>
              <th className="text-left px-4 py-2 text-content-tertiary font-medium">Agent</th>
              <th className="text-right px-4 py-2 text-content-tertiary font-medium">Tasks</th>
              <th className="text-right px-4 py-2 text-content-tertiary font-medium">Success</th>
              <th className="text-right px-4 py-2 text-content-tertiary font-medium">Tokens</th>
              <th className="text-right px-4 py-2 text-content-tertiary font-medium">Avg TTFT</th>
              <th className="text-right px-4 py-2 text-content-tertiary font-medium">Avg Time</th>
              <th className="text-right px-4 py-2 text-content-tertiary font-medium">Last Active</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const successRate = s.total_tasks > 0 ? Math.round((s.completed / s.total_tasks) * 100) : 0;
              return (
                <tr
                  key={s.agent_id}
                  className={`border-t border-divider/50 hover:bg-surface-elevated cursor-pointer ${
                    selectedAgent === s.agent_id ? 'bg-accent-blue/10' : ''
                  }`}
                  onClick={() => setSelectedAgent(selectedAgent === s.agent_id ? null : s.agent_id)}
                >
                  <td className="px-4 py-2 font-medium text-content-primary">{s.agent_id}</td>
                  <td className="px-4 py-2 text-right text-content-secondary">{s.total_tasks}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={successRate >= 90 ? 'text-green-400' : successRate >= 70 ? 'text-yellow-400' : 'text-red-400'}>
                      {successRate}%
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-content-tertiary">
                    {formatTokens(s.total_prompt_tokens + s.total_completion_tokens)}
                  </td>
                  <td className="px-4 py-2 text-right text-content-tertiary">{s.avg_ttft_ms}ms</td>
                  <td className="px-4 py-2 text-right text-content-tertiary">{formatDuration(s.avg_total_ms)}</td>
                  <td className="px-4 py-2 text-right text-content-tertiary">{s.last_active ? timeAgo(s.last_active) : '—'}</td>
                </tr>
              );
            })}
            {stats.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-content-tertiary">
                  No telemetry data yet. Agent tasks will appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Agent detail panel */}
      {selectedStats && (
        <div className="mt-4 bg-surface-elevated border border-divider rounded-lg p-4">
          <h3 className="font-semibold text-content-primary mb-3">{selectedStats.agent_id} — Detail</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-content-tertiary">Completed:</span>{' '}
              <span className="text-green-400">{selectedStats.completed}</span>
            </div>
            <div>
              <span className="text-content-tertiary">Failed:</span>{' '}
              <span className="text-red-400">{selectedStats.failed}</span>
            </div>
            <div>
              <span className="text-content-tertiary">Prompt Tokens:</span>{' '}
              <span className="text-content-primary">{formatTokens(selectedStats.total_prompt_tokens)}</span>
            </div>
            <div>
              <span className="text-content-tertiary">Completion Tokens:</span>{' '}
              <span className="text-content-primary">{formatTokens(selectedStats.total_completion_tokens)}</span>
            </div>
            <div>
              <span className="text-content-tertiary">Avg TTFT:</span>{' '}
              <span className="text-content-primary">{selectedStats.avg_ttft_ms}ms</span>
            </div>
            <div>
              <span className="text-content-tertiary">Avg Total Time:</span>{' '}
              <span className="text-content-primary">{formatDuration(selectedStats.avg_total_ms)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Helpers ──────────────────────────────────────────────────────

const MetricCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => {
  const borderColor = `border-accent-${color}`;
  return (
    <div className={`bg-surface-elevated border-l-4 ${borderColor} rounded p-4`}>
      <div className="text-xs text-content-tertiary mb-1">{label}</div>
      <div className="text-xl font-bold text-content-primary">{value}</div>
    </div>
  );
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}min`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default RuntimeDashboard;
