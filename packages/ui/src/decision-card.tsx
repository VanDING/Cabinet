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
    L1: 'bg-green-100 text-intent-success',
    L2: 'bg-amber-100 text-amber-700',
    L3: 'bg-red-100 text-intent-danger',
  };

  return (
    <div className="rounded-lg border bg-surface-primary p-4 transition-shadow hover:shadow-md">
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${levelColors[decision.level] ?? 'bg-surface-muted'}`}
        >
          {decision.level}
        </span>
        <span className="text-xs text-content-tertiary">{decision.type}</span>
      </div>
      <h3 className="mb-1 font-medium text-content-primary">{decision.title}</h3>
      <p className="mb-3 line-clamp-2 text-sm text-content-tertiary">
        {decision.description}
      </p>

      {variant === 'full' && (
        <div className="mb-3">
          {decision.options.map((opt) => (
            <label
              key={opt.id}
              className="flex items-start gap-2 border-b py-1.5 text-sm last:border-0"
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
                <div className="font-medium text-content-secondary">{opt.label}</div>
                <div className="text-xs text-content-tertiary">{opt.impact}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {onApprove && decision.status === 'pending' && (
          <button
            onClick={() => onApprove(decision.id, selectedOptionId)}
            className="rounded bg-intent-success px-3 py-1.5 text-sm text-content-inverse hover:bg-green-700"
          >
            Approve
          </button>
        )}
        {onReject && decision.status === 'pending' && (
          <button
            onClick={() => onReject(decision.id)}
            className="rounded bg-red-100 px-3 py-1.5 text-sm text-intent-danger hover:bg-red-200"
          >
            Reject
          </button>
        )}
        {onViewDetails && (
          <button
            onClick={() => onViewDetails(decision.id)}
            className="rounded border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-elevated"
          >
            Details
          </button>
        )}
      </div>
    </div>
  );
}
