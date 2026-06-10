import { useState } from 'react';
import type { StructuredOutput, DecisionProposalData } from '@cabinet/types';

export interface DecisionProposalCardProps {
  output: StructuredOutput;
  variant?: 'compact' | 'full';
  onAdopt?: (outputId: string, optionLabel: string) => void;
  onRequestMore?: (outputId: string) => void;
  onReject?: (outputId: string) => void;
  onViewDetails?: (outputId: string) => void;
}

function getData(output: StructuredOutput): DecisionProposalData {
  return output.data as unknown as DecisionProposalData;
}

const priorityColors: Record<string, string> = {
  high: 'bg-intent-danger-muted text-intent-danger',
  medium: 'bg-intent-warning-muted text-intent-warning',
  low: 'bg-surface-muted text-content-secondary',
};

const priorityLabels: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function DecisionProposalCard({
  output,
  variant = 'compact',
  onAdopt,
  onRequestMore,
  onReject,
  onViewDetails,
}: DecisionProposalCardProps) {
  const data = getData(output);
  const [selectedOption, setSelectedOption] = useState(data.recommendation);
  const isResolved = output.status !== 'proposed';

  const statusBar = isResolved ? (
    <div
      className={`mb-2 rounded px-3 py-1.5 text-xs font-medium ${
        output.status === 'accepted'
          ? 'bg-intent-success-muted text-intent-success'
          : output.status === 'rejected'
            ? 'bg-intent-danger-muted text-intent-danger'
            : 'bg-intent-info-muted text-intent-info'
      }`}
    >
      {output.status === 'accepted'
        ? `✅ Adopted · ${data.recommendation}`
        : output.status === 'rejected'
          ? '❌ Rejected'
          : `↩ Modified · ${data.recommendation}`}
    </div>
  ) : null;

  if (variant === 'compact') {
    return (
      <div className="my-3 rounded-lg border border-border bg-surface-primary p-3">
        {statusBar}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-content-primary">📋 {data.title}</span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${priorityColors[data.priority] ?? priorityColors.medium}`}
          >
            {priorityLabels[data.priority] ?? data.priority}
          </span>
        </div>
        <p className="mb-1 text-xs text-content-secondary">{data.summary}</p>
        <p className="mb-2 text-xs text-content-tertiary">
          Recommendation: <span className="font-medium text-content-primary">{data.recommendation}</span>
        </p>
        {!isResolved && (
          <div className="flex gap-2">
            {onAdopt && (
              <button
                onClick={() => onAdopt(output.id, selectedOption)}
                className="rounded bg-intent-success px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                ✅ Adopt {data.recommendation}
              </button>
            )}
            {onRequestMore && (
              <button
                onClick={() => onRequestMore(output.id)}
                className="rounded border border-border px-3 py-1.5 text-xs text-content-secondary hover:bg-surface-elevated"
              >
                ↩ Request More
              </button>
            )}
            {onReject && (
              <button
                onClick={() => onReject(output.id)}
                className="rounded px-3 py-1.5 text-xs text-intent-danger hover:bg-intent-danger-muted"
              >
                ❌ Reject
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-border bg-surface-primary p-4">
      {statusBar}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-content-primary">📋 {data.title}</h3>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${priorityColors[data.priority] ?? priorityColors.medium}`}
        >
          {priorityLabels[data.priority] ?? data.priority}
        </span>
      </div>
      <p className="mb-3 text-sm text-content-secondary">{data.summary}</p>

      <div className="mb-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2 text-left font-medium text-content-secondary">Dimension</th>
              {data.options.map((opt) => (
                <th key={opt.label} className="px-2 py-1.5 text-center font-medium text-content-secondary">
                  {opt.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.dimensions.map((dim) => (
              <tr key={dim} className="border-b border-border-subtle last:border-0">
                <td className="py-1.5 pr-2 text-content-primary">{dim}</td>
                {data.options.map((opt) => {
                  const score = opt.scores[dim];
                  const isMax =
                    score !== undefined &&
                    data.options.every((o) => (o.scores[dim] ?? 0) <= score);
                  return (
                    <td
                      key={opt.label}
                      className={`px-2 py-1.5 text-center ${isMax ? 'font-semibold text-intent-success' : 'text-content-tertiary'}`}
                    >
                      {score !== undefined ? `${score}/10` : '-'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mb-3 text-xs text-accent">
        AI recommends: <span className="font-semibold">{data.recommendation}</span>
      </p>

      {!isResolved && (
        <div className="flex gap-2">
          {onAdopt && (
            <button
              onClick={() => onAdopt(output.id, selectedOption)}
              className="rounded bg-intent-success px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              ✅ Adopt
            </button>
          )}
          {onRequestMore && (
            <button
              onClick={() => onRequestMore(output.id)}
              className="rounded border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-elevated"
            >
              ↩ Request More
            </button>
          )}
          {onReject && (
            <button
              onClick={() => onReject(output.id)}
              className="rounded px-3 py-1.5 text-sm text-intent-danger hover:bg-intent-danger-muted"
            >
              ❌ Reject
            </button>
          )}
        </div>
      )}
      {onViewDetails && (
        <button
          onClick={() => onViewDetails(output.id)}
          className="mt-2 text-xs text-content-tertiary hover:text-content-secondary"
        >
          View details →
        </button>
      )}
    </div>
  );
}
