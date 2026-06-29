import type { StructuredOutput, WorkflowResultData } from '@cabinet/types';
import { Card, CardContent, CardFooter } from
  '../../../apps/desktop/src/components/ui/card.js';
import { Button } from
  '../../../apps/desktop/src/components/ui/button.js';

export interface WorkflowResultCardProps {
  output: StructuredOutput;
  onViewReport?: (outputId: string) => void;
  onRerun?: (outputId: string) => void;
  onFixIssue?: (outputId: string, alert: { severity: string; message: string }) => void;
}

function getData(output: StructuredOutput): WorkflowResultData {
  return output.data as unknown as WorkflowResultData;
}

const nodeStatusIcons: Record<string, string> = { success: '✅', error: '❌', warning: '⚠' };
const nodeStatusColors: Record<string, string> = {
  success: 'text-[var(--intent-success)]', error: 'text-[var(--intent-danger)]', warning: 'text-[var(--intent-warning)]',
};

export function WorkflowResultCard({ output, onViewReport, onRerun, onFixIssue }: WorkflowResultCardProps) {
  const data = getData(output);
  const overallIcon = data.success ? '✅' : '❌';
  const overallLabel = data.success ? 'Completed' : 'Failed';
  const overallColor = data.success ? 'text-[var(--intent-success)]' : 'text-[var(--intent-danger)]';
  const overallBg = data.success ? 'bg-[var(--intent-success-muted)]' : 'bg-[var(--intent-danger-muted)]';
  const durationSec = Math.round(data.durationMs / 1000);

  return (
    <Card className="my-3">
      <CardContent>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-content-primary text-sm font-semibold">🔧 {data.workflowName}</span>
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${overallBg} ${overallColor}`}>
            {overallIcon} {overallLabel} · {durationSec}s
          </span>
        </div>

        {data.nodeResults.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {data.nodeResults.map((node, i) => (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-content-tertiary text-xs">→</span>}
                <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs ${nodeStatusColors[node.status] ?? ''} bg-[var(--surface-muted)]`}
                      title={node.details}>
                  <span className="text-xs">{nodeStatusIcons[node.status] ?? '·'}</span>
                  <span>{node.type}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {data.alerts.length > 0 && (
          <div className="mb-3">
            {data.alerts.map(alert => (
              <div key={alert.message} className="flex items-start gap-1.5 border-b border-[var(--border-subtle)] py-1 last:border-0">
                <span className="text-[var(--intent-warning)] mt-0.5 text-xs">⚠</span>
                <div className="flex-1"><span className="text-content-primary text-xs">{alert.message}</span></div>
                {onFixIssue && (
                  <button onClick={() => onFixIssue(output.id, alert)} className="text-[var(--accent)] shrink-0 text-xs hover:underline">
                    Fix
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <CardFooter className="flex gap-2 px-0">
          {onViewReport && (
            <Button variant="outline" onClick={() => onViewReport(output.id)}>📋 View Report</Button>
          )}
          {onRerun && (
            <Button variant="outline" onClick={() => onRerun(output.id)}>🔄 Rerun</Button>
          )}
        </CardFooter>
      </CardContent>
    </Card>
  );
}
