import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface HealthData {
  recentSessions: number;
  successRate: number;
  avgCostPerSession: number;
  toolHealth: 'healthy' | 'degraded' | 'unhealthy';
  contextHealth: 'healthy' | 'warning' | 'critical';
}

export function ObservabilityWidget() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/observability/health', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { setHealth(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!health) {
    return (
      <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4">
        <p className="text-xs text-gray-400">Observability data unavailable.</p>
      </div>
    );
  }

  const healthDot = (status: string) => {
    switch (status) {
      case 'healthy': return '\u{1F7E2}';
      case 'degraded': case 'warning': return '\u{1F7E1}';
      case 'unhealthy': case 'critical': return '\u{1F534}';
      default: return '\u{26AA}';
    }
  };

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4 overflow-hidden">
      <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200 mb-3">Agent Health</h3>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
          <div className="text-gray-400">Sessions</div>
          <div className="text-gray-800 dark:text-gray-200 font-semibold text-lg">{health.recentSessions}</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
          <div className="text-gray-400">Success Rate</div>
          <div className={`font-semibold text-lg ${health.successRate >= 0.9 ? 'text-green-600' : health.successRate >= 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
            {(health.successRate * 100).toFixed(0)}%
          </div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
          <div className="text-gray-400">Avg Cost</div>
          <div className="text-gray-800 dark:text-gray-200 font-semibold text-lg">${health.avgCostPerSession.toFixed(3)}</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-900 rounded p-2">
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
