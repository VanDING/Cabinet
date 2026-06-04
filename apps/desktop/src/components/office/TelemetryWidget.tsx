import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/api.js';

interface TrendData {
  summary: { total_tasks: number; success_rate: number; total_tokens: number; active_agents: number };
  buckets: Array<{ ts: string; task_count: number; tokens_prompt: number; tokens_completion: number; avg_ttft_ms: number; avg_total_ms: number }>;
  agents: Array<{ agent_id: string; avg_total_ms: number; avg_ttft_ms: number; total_tasks: number }>;
}

export function TelemetryWidget() {
  const [data, setData] = useState<TrendData | null>(null);
  const [agentId, setAgentId] = useState('all');
  const [range, setRange] = useState('24h');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/telemetry/trends?agent_id=${agentId}&range=${range}`, { headers: authHeaders() });
      setData(await res.json() as TrendData);
    } catch { /* non-critical */ }
    setLoading(false);
  }, [agentId, range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) {
    return <div className="p-4 text-sm text-content-tertiary">Loading telemetry...</div>;
  }

  const s = data.summary;

  return (
    <div className="space-y-3 p-3">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}
          className="rounded border border-border bg-surface-primary px-2 py-1 text-xs text-content-primary">
          <option value="all">All Agents</option>
          {data.agents.map((a) => <option key={a.agent_id} value={a.agent_id}>{a.agent_id}</option>)}
        </select>
        <div className="flex gap-1">
          {(['24h', '7d', '30d'] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`rounded px-2 py-0.5 text-xs ${range === r ? 'bg-accent text-white' : 'text-content-tertiary hover:text-content-secondary'}`}>{r}</button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2">
        <StatBox label="Tasks" value={s.total_tasks.toLocaleString()} />
        <StatBox label="Success" value={s.success_rate + '%'} />
        <StatBox label="Tokens" value={formatTokens(s.total_tokens as number)} />
        <StatBox label="Agents" value={String(s.active_agents)} />
      </div>

      {/* Token trend mini area chart (text-based fallback) */}
      <div className="rounded border border-border bg-surface-primary p-3">
        <h4 className="mb-2 text-xs font-medium text-content-secondary">Token Trend</h4>
        <div className="flex items-end gap-px h-16">
          {data.buckets.slice(-48).map((b, i) => {
            const max = Math.max(...data.buckets.map((x) => x.tokens_prompt + x.tokens_completion), 1);
            const h = Math.max(2, ((b.tokens_prompt + b.tokens_completion) / max) * 64);
            return <div key={i} className="flex-1 bg-accent/60 rounded-t-sm" style={{ height: h + 'px' }}
              title={`${b.ts}: ${formatTokens(b.tokens_prompt + b.tokens_completion)}`} />;
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-content-tertiary">
          <span>{data.buckets[0]?.ts?.slice(11, 16) ?? '—'}</span>
          <span className="flex gap-2">
            <span>▓ prompt</span>
            <span>░ completion</span>
          </span>
          <span>{data.buckets[data.buckets.length - 1]?.ts?.slice(11, 16) ?? '—'}</span>
        </div>
      </div>

      {/* Agent latency bar chart */}
      <div className="rounded border border-border bg-surface-primary p-3">
        <h4 className="mb-2 text-xs font-medium text-content-secondary">Agent Latency</h4>
        {data.agents.slice(0, 8).map((a) => (
          <div key={a.agent_id} className="flex items-center gap-2 mb-1">
            <span className="w-20 text-xs text-content-secondary truncate">{a.agent_id}</span>
            <div className="flex-1 h-3 bg-surface-muted rounded-sm overflow-hidden">
              <div className="h-full bg-accent/70 rounded-sm" style={{
                width: Math.min(100, (a.avg_total_ms / Math.max(...data.agents.map((x) => x.avg_total_ms), 1)) * 100) + '%',
              }} />
            </div>
            <span className="text-xs text-content-tertiary w-12 text-right">{formatDuration(a.avg_total_ms)}</span>
          </div>
        ))}
      </div>

      {/* TTFT table */}
      <div className="rounded border border-border bg-surface-primary p-3">
        <h4 className="mb-2 text-xs font-medium text-content-secondary">TTFT (Time to First Token)</h4>
        <div className="text-xs text-content-tertiary space-y-1">
          {data.agents.map((a) => (
            <div key={a.agent_id} className="flex justify-between">
              <span>{a.agent_id}</span>
              <span>{a.avg_ttft_ms}ms avg · {a.total_tasks} tasks</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface-primary p-2 text-center">
      <div className="text-lg font-bold text-content-primary">{value}</div>
      <div className="text-[10px] text-content-tertiary">{label}</div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return (ms / 60_000).toFixed(1) + 'min';
  if (ms >= 1_000) return (ms / 1_000).toFixed(1) + 's';
  return ms + 'ms';
}
