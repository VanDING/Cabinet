import { useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';
import { usePolling } from '../../hooks/usePolling';

interface HealthData {
  recentSessions: number;
  successRate: number;
  avgCostPerSession: number;
  toolHealth: 'healthy' | 'degraded' | 'unhealthy';
  contextHealth: 'healthy' | 'warning' | 'critical';
}

export function ObservabilityWidget() {
  const {
    data: health,
    loading,
    refresh,
  } = usePolling<HealthData>(
    () => apiFetch('/api/observability/health', { headers: authHeaders() }).then((r) => r.json()),
    30000,
  );

  useEffect(() => {
    const handler = () => {
      refresh();
    };
    window.addEventListener('ws:secretary_message', handler);
    window.addEventListener('ws:task_completed', handler);
    window.addEventListener('ws:workflow_completed', handler);
    return () => {
      window.removeEventListener('ws:secretary_message', handler);
      window.removeEventListener('ws:task_completed', handler);
      window.removeEventListener('ws:workflow_completed', handler);
    };
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface-primary p-4 shadow-sm">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!health) {
    return (
      <div className="h-full rounded-lg border border-border bg-surface-primary p-4 shadow-sm">
        <p className="text-xs text-content-tertiary">Observability data unavailable.</p>
      </div>
    );
  }

  const healthDot = (status: string) => {
    switch (status) {
      case 'healthy':
        return '\u{1F7E2}';
      case 'degraded':
      case 'warning':
        return '\u{1F7E1}';
      case 'unhealthy':
      case 'critical':
        return '\u{1F534}';
      default:
        return '\u{26AA}';
    }
  };

  return (
    <div className="h-full overflow-hidden rounded-lg border border-border bg-surface-primary shadow-sm p-4">
      <h3 className="mb-3 text-xs font-semibold text-content-secondary">Agent Health</h3>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-surface-elevated p-2">
          <div className="text-content-tertiary">Sessions</div>
          <div className="text-lg font-semibold text-content-primary">
            {health.recentSessions}
          </div>
        </div>
        <div className="rounded bg-surface-elevated p-2">
          <div className="text-content-tertiary">Success Rate</div>
          <div
            className={`text-lg font-semibold ${health.successRate >= 0.9 ? 'text-intent-success' : health.successRate >= 0.7 ? 'text-intent-warning' : 'text-intent-danger'}`}
          >
            {(health.successRate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="rounded bg-surface-elevated p-2">
          <div className="text-content-tertiary">Avg Cost</div>
          <div className="text-lg font-semibold text-content-primary">
            ${health.avgCostPerSession.toFixed(3)}
          </div>
        </div>
        <div className="rounded bg-surface-elevated p-2">
          <div className="text-content-tertiary">Tools</div>
          <div className="text-lg">{healthDot(health.toolHealth)}</div>
        </div>
      </div>

      <div className="mt-2 flex gap-3 text-xs text-content-tertiary">
        <span>Context: {healthDot(health.contextHealth)}</span>
        <span>Tools: {healthDot(health.toolHealth)}</span>
      </div>
    </div>
  );
}
