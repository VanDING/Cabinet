import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch, authHeaders } from '../../utils/api.js';

interface HarnessData {
  today: {
    toolPassRate: number;
    sessionSuccessRate: number;
    sessions: number;
  };
  health: {
    toolHealth: string;
    contextHealth: string;
    successRate: number;
  };
  trend: { date: string; toolSuccessRate: number; sessionSuccessRate: number }[];
  lastEscalation: {
    type: string;
    severity: string;
    description: string;
    timestamp: string;
  } | null;
}

interface Props {
  onExpand?: () => void;
}

export function HarnessWidget({ onExpand }: Props) {
  const [data, setData] = useState<HarnessData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    apiFetch('/api/harness/overview', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setData(d);
      })
      .catch((err) => { console.warn('Operation failed', err); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    window.addEventListener('ws:quality_alert', fetchData);
    window.addEventListener('ws:task_updated', fetchData);
    return () => {
      window.removeEventListener('ws:quality_alert', fetchData);
      window.removeEventListener('ws:task_updated', fetchData);
    };
  }, [fetchData]);

  const chartData = (data?.trend ?? []).map((d) => ({
    date: new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }),
    rate: Math.round(d.toolSuccessRate * 100),
  }));

  return (
    <div
      onClick={onExpand}
      className={`flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-xs ${
        onExpand ? 'cursor-pointer' : ''
      }`}
    >
      <h3 className="mb-3 text-xs font-semibold text-content-secondary">Harness</h3>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : !data ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          No harness data
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-hidden">
          {/* Today stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-sm bg-surface-muted p-1.5">
              <div className="text-sm font-bold text-content-primary">
                {data.today.toolPassRate > 0
                  ? `${Math.round(data.today.toolPassRate * 100)}%`
                  : '--'}
              </div>
              <div className="text-[10px] text-content-tertiary">Tool Pass</div>
            </div>
            <div className="rounded-sm bg-surface-muted p-1.5">
              <div className="text-sm font-bold text-content-primary">
                {data.today.sessionSuccessRate > 0
                  ? `${Math.round(data.today.sessionSuccessRate * 100)}%`
                  : '--'}
              </div>
              <div className="text-[10px] text-content-tertiary">Success</div>
            </div>
            <div className="rounded-sm bg-surface-muted p-1.5">
              <div className="text-sm font-bold text-content-primary">
                {data.today.sessions}
              </div>
              <div className="text-[10px] text-content-tertiary">Sessions</div>
            </div>
          </div>

          {/* Mini trend chart */}
          {chartData.length > 0 && (
            <div style={{ height: 70 }}>
              <div className="mb-0.5 text-[10px] text-content-tertiary">7-day tool pass rate</div>
              <ResponsiveContainer width="100%" height="90%">
                <BarChart data={chartData} margin={{ top: 0, left: 0, right: 0, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: 'var(--content-tertiary)' }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: 'var(--content-tertiary)' }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} formatter={(v) => [`${Number(v)}%`, 'Pass Rate']} />
                  <Bar dataKey="rate" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Last escalation */}
          {data.lastEscalation && (
            <div className="rounded-sm border border-border bg-surface-muted p-1.5">
              <div className="text-[10px] text-content-tertiary">Last escalation</div>
              <div className="truncate text-xs text-content-secondary">
                {data.lastEscalation.description}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
