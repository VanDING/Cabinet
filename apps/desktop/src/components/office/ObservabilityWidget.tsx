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
  const { data: health, loading } = usePolling<HealthData>(
    () => apiFetch('/api/observability/health', { headers: authHeaders() }).then((r) => r.json()),
    30000,
  );

  useEffect(() => {
    const handler = () => {
      apiFetch('/api/observability/health', { headers: authHeaders() })
        .then((r) => r.json())
        .catch(() => {});
    };
    window.addEventListener('ws:secretary_message', handler);
    window.addEventListener('ws:task_completed', handler);
    window.addEventListener('ws:workflow_completed', handler);
    return () => {
      window.removeEventListener('ws:secretary_message', handler);
      window.removeEventListener('ws:task_completed', handler);
      window.removeEventListener('ws:workflow_completed', handler);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!health) {
    return (
      <div className="h-full rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs text-gray-400">Observability data unavailable.</p>
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
    <div className="h-full overflow-hidden rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">Agent Health</h3>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-gray-50 p-2 dark:bg-gray-900">
          <div className="text-gray-400">Sessions</div>
          <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            {health.recentSessions}
          </div>
        </div>
        <div className="rounded bg-gray-50 p-2 dark:bg-gray-900">
          <div className="text-gray-400">Success Rate</div>
          <div
            className={`text-lg font-semibold ${health.successRate >= 0.9 ? 'text-green-600' : health.successRate >= 0.7 ? 'text-amber-600' : 'text-red-600'}`}
          >
            {(health.successRate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="rounded bg-gray-50 p-2 dark:bg-gray-900">
          <div className="text-gray-400">Avg Cost</div>
          <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            ${health.avgCostPerSession.toFixed(3)}
          </div>
        </div>
        <div className="rounded bg-gray-50 p-2 dark:bg-gray-900">
          <div className="text-gray-400">Tools</div>
          <div className="text-lg">{healthDot(health.toolHealth)}</div>
        </div>
      </div>

      <div className="mt-2 flex gap-3 text-xs text-gray-500">
        <span>Context: {healthDot(health.contextHealth)}</span>
        <span>Tools: {healthDot(health.toolHealth)}</span>
      </div>
    </div>
  );
}
