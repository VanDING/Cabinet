import { ModalOverlay } from '../ModalOverlay';
import { useEffect } from 'react';
import { X, Shield, AlertTriangle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useHarnessData } from './useHarnessData.js';

interface Props {
  onClose: () => void;
}
export function HarnessModal({ onClose }: Props) {
  const { data, loading } = useHarnessData();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const chartData = (data?.trend ?? []).map((d) => ({
    date: new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' }),
    toolRate: Math.round(d.toolSuccessRate * 100),
    sessionRate: Math.round(d.sessionSuccessRate * 100),
  }));

  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      contentClassName="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg"
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-accent" />
          <h3 className="text-content-primary text-lg font-semibold">Harness</h3>
        </div>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-secondary flex h-6 w-6 items-center justify-center rounded-sm"
        >
          <X size={16} />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="border-accent h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : !data ? (
        <div className="text-content-tertiary py-12 text-center text-sm">No harness data</div>
      ) : (
        <div className="space-y-4 overflow-y-auto px-5 pb-4">
          <section>
            <h4 className="text-content-secondary mb-2 text-xs font-medium">System Health</h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="border-border bg-surface-muted rounded-lg border p-3 text-center">
                <div className="text-content-primary text-sm font-bold">
                  {data.health.successRate > 0
                    ? `${Math.round(data.health.successRate * 100)}%`
                    : '--'}
                </div>
                <div className="text-content-tertiary text-[10px]">Session Success</div>
              </div>
              <div className="border-border bg-surface-muted rounded-lg border p-3 text-center">
                <div className="text-content-primary text-sm font-bold capitalize">
                  {data.health.toolHealth}
                </div>
                <div className="text-content-tertiary text-[10px]">Tool Health</div>
              </div>
              <div className="border-border bg-surface-muted rounded-lg border p-3 text-center">
                <div className="text-content-primary text-sm font-bold capitalize">
                  {data.health.contextHealth}
                </div>
                <div className="text-content-tertiary text-[10px]">Context Health</div>
              </div>
            </div>
          </section>
          {chartData.length > 0 && (
            <section>
              <h4 className="text-content-secondary mb-2 text-xs font-medium">7-Day Trend</h4>
              <div style={{ width: '100%', height: 200, minWidth: 1 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={chartData} margin={{ top: 4, left: 0, right: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: 'var(--content-tertiary)' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                      width={36}
                    />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                    <Bar
                      dataKey="toolRate"
                      name="Tool Pass Rate"
                      fill="var(--accent)"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={24}
                    />
                    <Bar
                      dataKey="sessionRate"
                      name="Session Success"
                      fill="var(--chart-2)"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </div>
      )}
    </ModalOverlay>
  );
}
