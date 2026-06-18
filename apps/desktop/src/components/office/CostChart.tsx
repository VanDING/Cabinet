import { useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useCostHistory, formatTokens, formatCost, type Period } from './useCostHistory.js';

export function CostChart() {
  const { history, loading, period, setPeriod, fetchData, costSubtotal, tokenSubtotal, chartData } =
    useCostHistory();

  useEffect(() => {
    window.addEventListener('ws:cost_updated', fetchData);
    window.addEventListener('ws:workflow_completed', fetchData);
    return () => {
      window.removeEventListener('ws:cost_updated', fetchData);
      window.removeEventListener('ws:workflow_completed', fetchData);
    };
  }, [fetchData]);

  return (
    <div style={{ padding: '20px 24px' }}>
      <div className="mb-3 flex items-center justify-between">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--content-primary)',
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          Cost Analysis
        </div>
        <div className="bg-surface-muted flex rounded-sm p-0.5">
          {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={(e) => {
                e.stopPropagation();
                setPeriod(p);
              }}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${period === p ? 'bg-surface-primary text-content-primary shadow-xs' : 'text-content-tertiary hover:text-content-secondary'}`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <div className="border-accent h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : history.length === 0 ? (
        <div className="text-content-tertiary flex h-48 items-center justify-center text-xs">
          No data yet
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <span className="text-accent text-xl font-bold">¥{formatCost(costSubtotal)}</span>
              <span className="text-content-tertiary ml-2 text-xs">Cost</span>
            </div>
            <div>
              <span className="text-accent text-xl font-bold">{formatTokens(tokenSubtotal)}</span>
              <span className="text-content-tertiary ml-2 text-xs">Tokens</span>
            </div>
          </div>
          <div className="flex flex-row gap-4">
            <div className="flex-1">
              <div className="text-content-tertiary mb-1 text-[10px]">Cost (7-day)</div>
              <div style={{ width: '100%', height: 120 }}>
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
                    <Bar
                      dataKey="cost"
                      fill="var(--accent)"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="flex-1">
              <div className="text-content-tertiary mb-1 text-[10px]">Tokens (7-day)</div>
              <div style={{ width: '100%', height: 120 }}>
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
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)
                      }
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
                    <Bar
                      dataKey="tokens"
                      fill="var(--accent)"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={24}
                    />
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
