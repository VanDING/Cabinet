import { useState, useEffect, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { apiFetch, authHeaders } from '../../utils/api.js';
import { ModalOverlay } from '../ModalOverlay';

interface HistoryPoint {
  date: string;
  cost: number;
  tokens: number;
}

type Period = 'daily' | 'weekly' | 'monthly';

interface Props {
  onClose: () => void;
}

function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCost(n: number): string {
  return n.toFixed(2);
}

const PERIOD_LABELS: Record<Period, string> = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
};

export function CostOverviewModal({ onClose }: Props) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('daily');

  const fetchData = useCallback(() => {
    apiFetch('/api/dashboard/cost-history?days=30', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.history) setHistory(data.history);
      })
      .catch((err) => { console.warn('Operation failed', err); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

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
    <ModalOverlay isOpen={true} onClose={onClose} contentClassName="m-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-xl border border-border bg-surface-primary shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
          <h3 className="text-lg font-semibold text-content-primary">Cost Overview</h3>

          {/* Period switcher */}
          <div className="flex rounded-sm bg-surface-muted p-0.5">
            {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  period === p
                    ? 'bg-surface-primary text-content-primary shadow-xs'
                    : 'text-content-tertiary hover:text-content-secondary'
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-content-tertiary hover:text-content-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : history.length === 0 ? (
          <div className="py-16 text-center text-sm text-content-tertiary">No data yet</div>
        ) : (
          <div className="px-6 pb-6">
            {/* Subtotals */}
            <div className="mb-6 flex items-baseline justify-between">
              <div>
                <span className="text-2xl font-bold text-accent">¥{formatCost(costSubtotal)}</span>
                <span className="ml-2 text-sm text-content-tertiary">Cost</span>
              </div>
              <div>
                <span className="text-2xl font-bold text-accent">{formatTokens(tokenSubtotal)}</span>
                <span className="ml-2 text-sm text-content-tertiary">Tokens</span>
              </div>
            </div>

            {/* Cost chart */}
            <div className="mb-6">
              <h4 className="mb-2 text-xs font-medium text-content-secondary">Cost Analysis (7-day)</h4>
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, left: 0, right: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => `$${v}`}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--surface-overlay)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value) => [`$${Number(value).toFixed(3)}`, 'Cost']}
                    />
                    <Bar dataKey="cost" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Token chart */}
            <div>
              <h4 className="mb-2 text-xs font-medium text-content-secondary">Token Analysis (7-day)</h4>
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, left: 0, right: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--surface-overlay)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value) => [formatTokens(Number(value)), 'Tokens']}
                    />
                    <Bar dataKey="tokens" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={32} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
    </ModalOverlay>
  );
}
