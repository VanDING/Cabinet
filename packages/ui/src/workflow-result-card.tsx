import type { StructuredOutput, WorkflowResultData } from '@cabinet/types';

export interface WorkflowResultCardProps {
  output: StructuredOutput;
  onViewReport?: (outputId: string) => void;
  onRerun?: (outputId: string) => void;
  onFixIssue?: (outputId: string, alert: { severity: string; message: string }) => void;
}

function getData(output: StructuredOutput): WorkflowResultData {
  return output.data as unknown as WorkflowResultData;
}

const nodeStatusIcons: Record<string, string> = {
  success: '✅',
  error: '❌',
  warning: '⚠',
};

const nodeStatusColors: Record<string, string> = {
  success: 'text-intent-success',
  error: 'text-intent-danger',
  warning: 'text-intent-warning',
};

export function WorkflowResultCard({
  output,
  onViewReport,
  onRerun,
  onFixIssue,
}: WorkflowResultCardProps) {
  const data = getData(output);

  const overallIcon = data.success ? '✅' : '❌';
  const overallLabel = data.success ? 'Completed' : 'Failed';
  const overallColor = data.success ? 'text-intent-success' : 'text-intent-danger';
  const overallBg = data.success ? 'bg-intent-success-muted' : 'bg-intent-danger-muted';
  const durationSec = Math.round(data.durationMs / 1000);

  return (
    <div className="my-3 rounded-lg border border-border bg-surface-primary p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-content-primary">🔧 {data.workflowName}</span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${overallBg} ${overallColor}`}
        >
          {overallIcon} {overallLabel} · {durationSec}s
        </span>
      </div>

      {/* Mini node flow */}
      {data.nodeResults.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {data.nodeResults.map((node, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-content-tertiary text-xs">→</span>}
              <span
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs ${nodeStatusColors[node.status] ?? ''} bg-surface-muted`}
                title={node.details}
              >
                <span className="text-xs">{nodeStatusIcons[node.status] ?? '·'}</span>
                <span>{node.type}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div className="mb-3">
          {data.alerts.map((alert) => (
            <div
              key={alert.message}
              className="flex items-start gap-1.5 border-b border-border-subtle py-1 last:border-0"
            >
              <span className="text-xs text-intent-warning mt-0.5">⚠</span>
              <div className="flex-1">
                <span className="text-xs text-content-primary">{alert.message}</span>
              </div>
              {onFixIssue && (
                <button
                  onClick={() => onFixIssue(output.id, alert)}
                  className="text-xs text-accent hover:underline shrink-0"
                >
                  Fix
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {onViewReport && (
          <button
            onClick={() => onViewReport(output.id)}
            className="rounded border border-border px-3 py-1.5 text-xs text-content-secondary hover:bg-surface-elevated"
          >
            📋 View Report
          </button>
        )}
        {onRerun && (
          <button
            onClick={() => onRerun(output.id)}
            className="rounded border border-border px-3 py-1.5 text-xs text-content-secondary hover:bg-surface-elevated"
          >
            🔄 Rerun
          </button>
        )}
      </div>
    </div>
  );
}
