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
    <div className="border-border bg-surface-primary my-3 rounded-lg border p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-content-primary text-sm font-semibold">📊 System Status</span>
        <span className="text-content-tertiary text-xs">
          {new Date(output.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Metric pills */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        <div className="bg-surface-muted rounded p-2 text-center">
          <div className="text-content-primary text-sm font-semibold">
            ${data.todayCost.toFixed(2)}
          </div>
          <div className="text-content-tertiary text-xs">Today</div>
        </div>
        <div className="bg-surface-muted rounded p-2 text-center">
          <div className="text-content-primary text-sm font-semibold">{data.activeAgents}</div>
          <div className="text-content-tertiary text-xs">Agents</div>
        </div>
        <div className="bg-surface-muted rounded p-2 text-center">
          <div className="text-content-primary text-sm font-semibold">{data.activeWorkflows}</div>
          <div className="text-content-tertiary text-xs">Workflows</div>
        </div>
        <div className="bg-surface-muted rounded p-2 text-center">
          <div className={`text-sm font-semibold ${healthColors[data.health] ?? ''}`}>
            {healthLabels[data.health] ?? data.health}
          </div>
          <div className="text-content-tertiary text-xs">Health</div>
        </div>
      </div>

      {/* Running workflows */}
      {data.runningWorkflows.length > 0 && (
        <div className="mb-3">
          <div className="text-content-secondary mb-1 text-xs font-medium">Running Workflows:</div>
          {data.runningWorkflows.map((wf) => (
            <div
              key={wf.name}
              className="border-border-subtle flex items-center justify-between border-b py-1 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="bg-accent h-1.5 w-1.5 animate-pulse rounded-full" />
                <span className="text-content-primary text-xs">{wf.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-content-tertiary text-xs">
                  {wf.currentNode} · {wf.progress}
                </span>
                {onViewWorkflow && (
                  <button
                    onClick={() => onViewWorkflow(wf.name)}
                    className="text-accent text-xs hover:underline"
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
          <div className="text-content-secondary mb-1 text-xs font-medium">⚠ Recent Alerts:</div>
          {data.alerts.map((alert) => (
            <div
              key={`${alert.time}-${alert.message}`}
              className="text-intent-warning flex items-start gap-1.5 py-0.5 text-xs"
            >
              <span className="mt-0.5 shrink-0">·</span>
              <span>
                {alert.message} <span className="text-content-tertiary">({alert.time})</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {onViewDashboard && (
        <button onClick={onViewDashboard} className="text-accent mt-1 text-xs hover:underline">
          View full Dashboard →
        </button>
      )}
    </div>
  );
}
