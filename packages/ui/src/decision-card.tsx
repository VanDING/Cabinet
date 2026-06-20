import { useState } from 'react';
import type { Decision } from '@cabinet/types';

export interface DecisionCardProps {
  decision: Decision;
  onApprove?: (id: string, optionId: string) => void;
  onReject?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  variant?: 'compact' | 'full';
}

export function DecisionCard({
  decision,
  onApprove,
  onReject,
  onViewDetails,
  variant = 'compact',
}: DecisionCardProps) {
  const [selectedOptionId, setSelectedOptionId] = useState(
    decision.chosenOptionId ?? decision.options[0]?.id ?? '',
  );

  const levelColors: Record<string, string> = {
    L0: 'bg-surface-muted text-content-secondary',
    L1: 'bg-intent-success-muted text-intent-success',
    L2: 'bg-intent-warning-muted text-intent-warning',
    L3: 'bg-intent-danger-muted text-intent-danger',
  };

  return (
    <div className="border-border bg-surface-primary rounded-lg border p-4 shadow-xs transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${levelColors[decision.level] ?? 'bg-surface-muted'}`}
        >
          {decision.level}
        </span>
        <span className="text-content-tertiary text-xs">{decision.type}</span>
      </div>
      <h3 className="text-content-primary mb-1 font-medium">{decision.title}</h3>
      <p className="text-content-tertiary mb-3 line-clamp-2 text-sm">{decision.description}</p>

      {variant === 'full' && (
        <div className="mb-3">
          {decision.options.map((opt) => (
            <label
              key={opt.id}
              className="border-hairline flex items-start gap-2 border-b py-1.5 text-sm last:border-0"
            >
              <input
                type="radio"
                name={`decision_${decision.id}`}
                value={opt.id}
                className="mt-0.5"
                checked={selectedOptionId === opt.id}
                onChange={() => setSelectedOptionId(opt.id)}
              />
              <div>
                <div className="text-content-secondary font-medium">{opt.label}</div>
                <div className="text-content-tertiary text-xs">{opt.impact}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {onApprove && decision.status === 'pending' && (
          <button
            onClick={() => onApprove(decision.id, selectedOptionId)}
            className="bg-intent-success text-content-inverse hover:bg-intent-success rounded-sm px-3 py-1.5 text-sm"
          >
            Approve
          </button>
        )}
        {onReject && decision.status === 'pending' && (
          <button
            onClick={() => onReject(decision.id)}
            className="bg-intent-danger-muted text-intent-danger hover:bg-intent-danger-muted rounded-sm px-3 py-1.5 text-sm"
          >
            Reject
          </button>
        )}
        {onViewDetails && (
          <button
            onClick={() => onViewDetails(decision.id)}
            className="border-border text-content-secondary hover:bg-surface-elevated rounded-sm border px-3 py-1.5 text-sm"
          >
            Details
          </button>
        )}
      </div>
    </div>
  );
}
