import { useState, useEffect } from 'react';
import { apiFetch, authHeaders } from '../utils/pin.js';

interface HealthData {
  recentSessions: number;
  successRate: number;
  avgCostPerSession: number;
  toolHealth: 'healthy' | 'degraded' | 'unhealthy';
  contextHealth: 'healthy' | 'warning' | 'critical';
}

interface ReportData {
  sessions: { total: number; succeeded: number; failed: number };
  tokens: { prompt: number; completion: number; total: number };
  cost: { total: number; avgPerSession: number };
  performance: { avgSteps: number; avgDurationMs: number; p95DurationMs: number };
  reliability: { toolSuccessRate: number; qualityPassRate: number };
  context: {
    avgPeakUtilization: number;
    totalHandoffs: number;
    zoneDistribution: { smart: number; warning: number; critical: number; dumb: number };
  };
}

interface ToolItem {
  toolName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number;
}

export function ObservabilityPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/observability/health', { headers: authHeaders() }).then(r => r.json()),
      apiFetch('/api/observability/report?days=7', { headers: authHeaders() }).then(r => r.json()),
      apiFetch('/api/observability/tools', { headers: authHeaders() }).then(r => r.json()),
    ])
      .then(([h, r, t]) => {
        setHealth(h);
        setReport(r.report);
        setTools(t.tools ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading observability data...</div>
      </div>
    );
  }

  const healthColor = (status: string) =>
    status === 'healthy' ? 'text-green-600 bg-green-50 dark:bg-green-900 dark:text-green-300' :
    status === 'degraded' || status === 'warning' ? 'text-amber-600 bg-amber-50 dark:bg-amber-900 dark:text-amber-300' :
    'text-red-600 bg-red-50 dark:bg-red-900 dark:text-red-300';

  const formatMs = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const formatTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Agent Observability</h1>

      {/* Health Cards */}
      {health && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
            <div className="text-xs text-gray-500 mb-1">Success Rate</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{(health.successRate * 100).toFixed(0)}%</div>
            <div className="text-xs text-gray-400">{health.recentSessions} recent sessions</div>
          </div>
          <div className="border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
            <div className="text-xs text-gray-500 mb-1">Tool Health</div>
            <div className={`text-lg font-semibold px-2 py-0.5 rounded-full inline-block ${healthColor(health.toolHealth)}`}>
              {health.toolHealth.toUpperCase()}
            </div>
          </div>
          <div className="border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
            <div className="text-xs text-gray-500 mb-1">Context Health</div>
            <div className={`text-lg font-semibold px-2 py-0.5 rounded-full inline-block ${healthColor(health.contextHealth)}`}>
              {health.contextHealth.toUpperCase()}
            </div>
          </div>
          <div className="border dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800">
            <div className="text-xs text-gray-500 mb-1">Avg Cost/Session</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">${health.avgCostPerSession.toFixed(3)}</div>
          </div>
        </div>
      )}

      {report && (
        <>
          {/* Performance */}
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Performance</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="text-xs text-gray-500">Total Sessions</div>
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{report.sessions.total}</div>
              <div className="text-xs text-gray-400">{report.sessions.succeeded} succeeded, {report.sessions.failed} failed</div>
            </div>
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="text-xs text-gray-500">Avg Steps</div>
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{report.performance.avgSteps}</div>
            </div>
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="text-xs text-gray-500">Avg Duration</div>
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatMs(report.performance.avgDurationMs)}</div>
            </div>
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="text-xs text-gray-500">P95 Duration</div>
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatMs(report.performance.p95DurationMs)}</div>
            </div>
          </div>

          {/* Tokens & Cost */}
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Tokens & Cost</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="text-xs text-gray-500">Total Tokens</div>
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatTokens(report.tokens.total)}</div>
              <div className="text-xs text-gray-400">Prompt: {formatTokens(report.tokens.prompt)} | Completion: {formatTokens(report.tokens.completion)}</div>
            </div>
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="text-xs text-gray-500">Total Cost</div>
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">${report.cost.total.toFixed(2)}</div>
            </div>
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="text-xs text-gray-500">Reliability</div>
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                Tool: {(report.reliability.toolSuccessRate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div className="text-xs text-gray-500">Avg Peak Context</div>
              <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{(report.context.avgPeakUtilization * 100).toFixed(0)}%</div>
              <div className="text-xs text-gray-400">{report.context.totalHandoffs} handoffs</div>
            </div>
          </div>

          {/* Context Zone Distribution */}
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Context Zone Distribution</h2>
          <div className="mb-6 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg p-4">
            <div className="flex h-6 rounded-full overflow-hidden">
              {[
                { zone: 'Smart (<40%)', count: report.context.zoneDistribution.smart, color: 'bg-green-500' },
                { zone: 'Warning (40-60%)', count: report.context.zoneDistribution.warning, color: 'bg-amber-500' },
                { zone: 'Critical (60-80%)', count: report.context.zoneDistribution.critical, color: 'bg-orange-500' },
                { zone: 'Dumb (>80%)', count: report.context.zoneDistribution.dumb, color: 'bg-red-500' },
              ].map(z => {
                const total = Object.values(report.context.zoneDistribution).reduce((a, b) => a + b, 0) || 1;
                const pct = (z.count / total) * 100;
                return pct > 0 ? (
                  <div key={z.zone} className={`${z.color} flex items-center justify-center text-[10px] text-white font-medium`}
                    style={{ width: `${pct}%` }} title={`${z.zone}: ${z.count}`}>
                    {pct > 10 ? `${pct.toFixed(0)}%` : ''}
                  </div>
                ) : null;
              })}
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              {['Smart', 'Warning', 'Critical', 'Dumb'].map(z => (
                <span key={z}>{z}</span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Tool Health */}
      {tools.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Tool Health</h2>
          <div className="space-y-2 mb-6">
            {tools.map(tool => {
              const rate = tool.totalCalls > 0 ? (tool.successCount / tool.totalCalls * 100) : 100;
              return (
                <div key={tool.toolName} className="border dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono">{tool.toolName}</div>
                    <div className="text-xs text-gray-500">
                      {tool.totalCalls} calls · {tool.successCount} ok · {tool.failureCount} fail · {formatMs(tool.avgDurationMs)} avg
                    </div>
                  </div>
                  <div className="flex-shrink-0 w-24">
                    <div className="text-xs text-gray-500 text-right mb-0.5">{rate.toFixed(0)}% success</div>
                    <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${rate > 95 ? 'bg-green-500' : rate > 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${rate}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
