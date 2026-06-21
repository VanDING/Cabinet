import { useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useHarnessData } from './useHarnessData.js';

interface Props {
  onExpand?: () => void;
}

export function HarnessWidget({ onExpand }: Props) {
  const { data, loading, fetchData } = useHarnessData();

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
      className={`border-border bg-surface-primary flex h-full flex-col rounded-lg border p-4 shadow-xs ${onExpand ? 'cursor-pointer' : ''}`}
    >
      <h3 className="text-content-secondary mb-3 text-xs font-semibold">Harness</h3>
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="border-accent h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : !data ? (
        <div className="text-content-tertiary flex flex-1 items-center justify-center text-xs">
          No harness data
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-hidden">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-surface-muted rounded-sm p-1.5">
              <div className="text-content-primary text-sm font-bold">
                {data.today.toolPassRate > 0
                  ? `${Math.round(data.today.toolPassRate * 100)}%`
                  : '--'}
              </div>
              <div className="text-content-tertiary text-[10px]">Tool Pass</div>
            </div>
            <div className="bg-surface-muted rounded-sm p-1.5">
              <div className="text-content-primary text-sm font-bold">
                {data.today.sessionSuccessRate > 0
                  ? `${Math.round(data.today.sessionSuccessRate * 100)}%`
                  : '--'}
              </div>
              <div className="text-content-tertiary text-[10px]">Success</div>
            </div>
            <div className="bg-surface-muted rounded-sm p-1.5">
              <div className="text-content-primary text-sm font-bold">{data.today.sessions}</div>
              <div className="text-content-tertiary text-[10px]">Sessions</div>
            </div>
          </div>
          {chartData.length > 0 && (
            <div style={{ width: '100%', height: 70, minWidth: 1 }}>
              <div className="text-content-tertiary mb-0.5 text-[10px]">7-day tool pass rate</div>
              <ResponsiveContainer width="100%" height="90%" minWidth={0} minHeight={0}>
                <BarChart data={chartData} margin={{ top: 0, left: 0, right: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 8, fill: 'var(--content-tertiary)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 8, fill: 'var(--content-tertiary)' }}
                    axisLine={false}
                    tickLine={false}
                    width={24}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 6 }}
                    formatter={(v) => [`${Number(v)}%`, 'Pass Rate']}
                  />
                  <Bar dataKey="rate" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {data.lastEscalation && (
            <div className="border-border bg-surface-muted rounded-sm border p-1.5">
              <div className="text-content-tertiary text-[10px]">Last escalation</div>
              <div className="text-content-secondary truncate text-xs">
                {data.lastEscalation.description}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
