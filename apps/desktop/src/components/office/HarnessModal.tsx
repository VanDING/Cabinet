import { useState, useEffect, useCallback } from 'react';
import { X, Shield, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch, authHeaders } from '../../utils/pin.js';

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
  recentActions: {
    type: string;
    severity: string;
    description: string;
    requiresApproval: boolean;
    applied: boolean;
    timestamp: string;
  }[];
  lastEscalation: {
    type: string;
    severity: string;
    description: string;
    timestamp: string;
  } | null;
}

interface Props {
  onClose: () => void;
}

const SEVERITY_ICONS: Record<string, typeof AlertTriangle> = {
  critical: AlertCircle,
  warning: AlertTriangle,
  info: CheckCircle2,
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-intent-danger',
  warning: 'text-intent-warning',
  info: 'text-intent-success',
};

export function HarnessModal({ onClose }: Props) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-accent" />
            <h3 className="text-lg font-semibold text-content-primary">Harness</h3>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-content-tertiary hover:text-content-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : !data ? (
          <div className="py-12 text-center text-sm text-content-tertiary">No harness data</div>
        ) : (
          <div className="overflow-y-auto px-5 pb-4 space-y-4">
            {/* Health overview */}
            <section>
              <h4 className="mb-2 text-xs font-medium text-content-secondary">System Health</h4>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-border bg-surface-muted p-3 text-center">
                  <div className="text-sm font-bold text-content-primary">
                    {data.health.successRate > 0
                      ? `${Math.round(data.health.successRate * 100)}%`
                      : '--'}
                  </div>
                  <div className="text-[10px] text-content-tertiary">Session Success</div>
                </div>
                <div className="rounded-lg border border-border bg-surface-muted p-3 text-center">
                  <div className="text-sm font-bold capitalize text-content-primary">
                    {data.health.toolHealth}
                  </div>
                  <div className="text-[10px] text-content-tertiary">Tool Health</div>
                </div>
                <div className="rounded-lg border border-border bg-surface-muted p-3 text-center">
                  <div className="text-sm font-bold capitalize text-content-primary">
                    {data.health.contextHealth}
                  </div>
                  <div className="text-[10px] text-content-tertiary">Context Health</div>
                </div>
              </div>
            </section>

            {/* 7-day trend */}
            {chartData.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-medium text-content-secondary">7-Day Trend</h4>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, left: 0, right: 0, bottom: 0 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--content-tertiary)' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--content-tertiary)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={36} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                      <Bar dataKey="toolRate" name="Tool Pass Rate" fill="var(--accent)" radius={[2, 2, 0, 0]} maxBarSize={24} />
                      <Bar dataKey="sessionRate" name="Session Success" fill="var(--chart-2)" radius={[2, 2, 0, 0]} maxBarSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* Recent actions */}
            {data.recentActions.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-medium text-content-secondary">Recent Actions</h4>
                <div className="space-y-1.5">
                  {data.recentActions.map((a, i) => {
                    const Icon = SEVERITY_ICONS[a.severity] ?? CheckCircle2;
                    const color = SEVERITY_COLORS[a.severity] ?? 'text-intent-success';
                    return (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-sm border border-border bg-surface-muted p-2.5"
                      >
                        <Icon size={14} className={`mt-0.5 shrink-0 ${color}`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-content-secondary">{a.description}</div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-content-tertiary">
                            <span className="capitalize">{a.severity}</span>
                            <span>{a.applied ? 'Applied' : 'Pending'}</span>
                            {a.requiresApproval && <span>Needs approval</span>}
                            <span className="ml-auto">
                              {new Date(a.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
