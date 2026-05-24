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
    L0: 'bg-gray-100 text-gray-600',
    L1: 'bg-green-100 text-green-700',
    L2: 'bg-amber-100 text-amber-700',
    L3: 'bg-red-100 text-red-700',
  };

  return (
    <div className="rounded-lg border bg-white p-4 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`rounded px-2 py-0.5 text-xs font-semibold ${levelColors[decision.level] ?? 'bg-gray-100'}`}
        >
          {decision.level}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{decision.type}</span>
      </div>
      <h3 className="mb-1 font-medium text-gray-900 dark:text-gray-100">{decision.title}</h3>
      <p className="mb-3 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
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
                <div className="font-medium text-gray-700 dark:text-gray-300">{opt.label}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{opt.impact}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {onApprove && decision.status === 'pending' && (
          <button
            onClick={() => onApprove(decision.id, selectedOptionId)}
            className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
          >
            Approve
          </button>
        )}
        {onReject && decision.status === 'pending' && (
          <button
            onClick={() => onReject(decision.id)}
            className="rounded bg-red-100 px-3 py-1.5 text-sm text-red-700 hover:bg-red-200"
          >
            Reject
          </button>
        )}
        {onViewDetails && (
          <button
            onClick={() => onViewDetails(decision.id)}
            className="rounded border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Details
          </button>
        )}
      </div>
    </div>
  );
}
