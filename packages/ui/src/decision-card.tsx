import type { Decision } from '@cabinet/types';

export interface DecisionCardProps {
  decision: Decision;
  onApprove?: (id: string, optionId: string) => void;
  onReject?: (id: string) => void;
  onViewDetails?: (id: string) => void;
  variant?: 'compact' | 'full';
}

export function DecisionCard({ decision, onApprove, onReject, onViewDetails, variant = 'compact' }: DecisionCardProps) {
  const levelColors: Record<string, string> = {
    L0: 'bg-gray-100 text-gray-600',
    L1: 'bg-green-100 text-green-700',
    L2: 'bg-amber-100 text-amber-700',
    L3: 'bg-red-100 text-red-700',
  };

  return (
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow bg-white">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${levelColors[decision.level] ?? 'bg-gray-100'}`}>
          {decision.level}
        </span>
        <span className="text-xs text-gray-400">{decision.type}</span>
      </div>
      <h3 className="font-medium text-gray-900 mb-1">{decision.title}</h3>
      <p className="text-sm text-gray-500 line-clamp-2 mb-3">{decision.description}</p>

      {variant === 'full' && (
        <div className="mb-3">
          {decision.options.map(opt => (
            <label key={opt.id} className="flex items-start gap-2 py-1.5 border-b last:border-0 text-sm">
              <input type="radio" name={`decision_${decision.id}`} value={opt.id}
                className="mt-0.5" defaultChecked={opt.id === decision.chosenOptionId} />
              <div>
                <div className="font-medium text-gray-700">{opt.label}</div>
                <div className="text-gray-500 text-xs">{opt.impact}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {onApprove && decision.status === 'pending' && (
          <button onClick={() => onApprove(decision.id, decision.options[0]?.id ?? '')}
            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700">
            Approve
          </button>
        )}
        {onReject && decision.status === 'pending' && (
          <button onClick={() => onReject(decision.id)}
            className="px-3 py-1.5 bg-red-100 text-red-700 text-sm rounded hover:bg-red-200">
            Reject
          </button>
        )}
        {onViewDetails && (
          <button onClick={() => onViewDetails(decision.id)}
            className="px-3 py-1.5 text-gray-600 text-sm border rounded hover:bg-gray-50">
            Details
          </button>
        )}
      </div>
    </div>
  );
}
