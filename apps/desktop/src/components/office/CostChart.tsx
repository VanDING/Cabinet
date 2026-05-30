import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface HistoryPoint {
  date: string;
  cost: number;
  tokens: number;
}

type Period = 'daily' | 'weekly' | 'monthly';

function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCost(n: number): string {
  return n.toFixed(2);
}

export function CostChart() {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('daily');

  const fetchData = useCallback(() => {
    apiFetch('/api/dashboard/cost-history?days=30', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.history) setHistory(data.history);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    window.addEventListener('ws:cost_updated', fetchData);
    window.addEventListener('ws:workflow_completed', fetchData);
    return () => {
      window.removeEventListener('ws:cost_updated', fetchData);
      window.removeEventListener('ws:workflow_completed', fetchData);
    };
  }, [fetchData]);

  const costSubtotal = useMemo(() => {
    if (history.length === 0) return 0;
    if (period === 'daily') return history[history.length - 1]!.cost;
    if (period === 'weekly') return history.slice(-7).reduce((s, h) => s + h.cost, 0);
    return history.reduce((s, h) => s + h.cost, 0);
  }, [history, period]);

  const tokenSubtotal = useMemo(() => {
    if (history.length === 0) return 0;
    if (period === 'daily') return history[history.length - 1]!.tokens;
    if (period === 'weekly') return history.slice(-7).reduce((s, h) => s + h.tokens, 0);
    return history.reduce((s, h) => s + h.tokens, 0);
  }, [history, period]);

  const chartData = useMemo(() => {
    return history.slice(-7).map((h) => ({
      date: new Date(h.date).toLocaleDateString(undefined, { weekday: 'short' }),
      cost: h.cost,
      tokens: h.tokens,
    }));
  }, [history]);

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-content-secondary">Cost Analysis</h3>
        <div className="flex rounded-sm bg-surface-muted p-0.5">
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={(e) => {
                e.stopPropagation();
                setPeriod(p);
              }}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                period === p
                  ? 'bg-surface-primary text-content-primary shadow-xs'
                  : 'text-content-tertiary hover:text-content-secondary'
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : history.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          No data yet
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Subtotals */}
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <span className="text-xl font-bold text-accent">¥{formatCost(costSubtotal)}</span>
              <span className="ml-2 text-xs text-content-tertiary">Cost</span>
            </div>
            <div>
              <span className="text-xl font-bold text-accent">{formatTokens(tokenSubtotal)}</span>
              <span className="ml-2 text-xs text-content-tertiary">Tokens</span>
            </div>
          </div>

          {/* Charts */}
          <div className="flex flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex-1">
              <div className="mb-0.5 text-[10px] text-content-tertiary">Cost (7-day)</div>
              <div style={{ height: 'calc(100% - 12px)' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 2, left: 0, right: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `$${v}`}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--surface-overlay)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                      formatter={(value) => [`$${Number(value).toFixed(3)}`, 'Cost']}
                    />
                    <Bar dataKey="cost" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex-1">
              <div className="mb-0.5 text-[10px] text-content-tertiary">Tokens (7-day)</div>
              <div style={{ height: 'calc(100% - 12px)' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 2, left: 0, right: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                      width={32}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--surface-overlay)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        fontSize: 11,
                      }}
                      formatter={(value) => [formatTokens(Number(value)), 'Tokens']}
                    />
                    <Bar dataKey="tokens" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
