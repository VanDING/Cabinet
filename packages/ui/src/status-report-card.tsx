import type { StructuredOutput, StatusReportData } from '@cabinet/types';

export interface StatusReportCardProps {
  output: StructuredOutput;
  onViewDashboard?: () => void;
  onViewWorkflow?: (name: string) => void;
}

function getData(output: StructuredOutput): StatusReportData {
  return output.data as unknown as StatusReportData;
}

const healthColors: Record<string, string> = {
  healthy: 'text-intent-success',
  degraded: 'text-intent-warning',
  error: 'text-intent-danger',
};

const healthLabels: Record<string, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  error: 'Error',
};

export function StatusReportCard({
  output,
  onViewDashboard,
  onViewWorkflow,
}: StatusReportCardProps) {
  const data = getData(output);

  return (
    <div className="my-3 rounded-lg border border-border bg-surface-primary p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-content-primary">📊 System Status</span>
        <span className="text-xs text-content-tertiary">
          {new Date(output.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Metric pills */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        <div className="rounded bg-surface-muted p-2 text-center">
          <div className="text-sm font-semibold text-content-primary">${data.todayCost.toFixed(2)}</div>
          <div className="text-xs text-content-tertiary">Today</div>
        </div>
        <div className="rounded bg-surface-muted p-2 text-center">
          <div className="text-sm font-semibold text-content-primary">{data.activeAgents}</div>
          <div className="text-xs text-content-tertiary">Agents</div>
        </div>
        <div className="rounded bg-surface-muted p-2 text-center">
          <div className="text-sm font-semibold text-content-primary">{data.activeWorkflows}</div>
          <div className="text-xs text-content-tertiary">Workflows</div>
        </div>
        <div className="rounded bg-surface-muted p-2 text-center">
          <div className={`text-sm font-semibold ${healthColors[data.health] ?? ''}`}>
            {healthLabels[data.health] ?? data.health}
          </div>
          <div className="text-xs text-content-tertiary">Health</div>
        </div>
      </div>

      {/* Running workflows */}
      {data.runningWorkflows.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-content-secondary">Running Workflows:</div>
          {data.runningWorkflows.map((wf) => (
            <div
              key={wf.name}
              className="flex items-center justify-between border-b border-border-subtle py-1 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />
                <span className="text-xs text-content-primary">{wf.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-content-tertiary">
                  {wf.currentNode} · {wf.progress}
                </span>
                {onViewWorkflow && (
                  <button
                    onClick={() => onViewWorkflow(wf.name)}
                    className="text-xs text-accent hover:underline"
                  >
                    View
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-xs font-medium text-content-secondary">⚠ Recent Alerts:</div>
          {data.alerts.map((alert) => (
            <div key={`${alert.time}-${alert.message}`} className="flex items-start gap-1.5 py-0.5 text-xs text-intent-warning">
              <span className="mt-0.5 shrink-0">·</span>
              <span>
                {alert.message} <span className="text-content-tertiary">({alert.time})</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {onViewDashboard && (
        <button
          onClick={onViewDashboard}
          className="mt-1 text-xs text-accent hover:underline"
        >
          View full Dashboard →
        </button>
      )}
    </div>
  );
}
