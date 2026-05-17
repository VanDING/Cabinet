import { useState, useEffect, memo } from 'react';
import type { Decision } from '@cabinet/types';
import { useToast } from '../Toast';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface Props {
  onSelectDecision?: (id: string) => void;
}

export const DecisionList = memo(function DecisionList({ onSelectDecision }: Props) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const { addToast } = useToast();

  const fetchDecisions = () => {
    apiFetch('/api/decisions?status=pending', { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (data.decisions) setDecisions(data.decisions);
      })
      .catch(() => {
        addToast('error', 'Failed to load decisions');
      });
  };

  useEffect(() => {
    fetchDecisions();
  }, [addToast]);

  // Listen for WebSocket decision updates
  useEffect(() => {
    const handleUpdate = () => fetchDecisions();
    window.addEventListener('ws:decision_created', handleUpdate);
    window.addEventListener('ws:decision_updated', handleUpdate);
    return () => {
      window.removeEventListener('ws:decision_created', handleUpdate);
      window.removeEventListener('ws:decision_updated', handleUpdate);
    };
  }, [addToast]);

  const levelBadge = (level: string) => {
    const colors: Record<string, string> = {
      L0: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      L1: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      L2: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      L3: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    };
    return colors[level] ?? 'bg-gray-100 text-gray-500';
  };

  return (
    <div className="h-full overflow-y-auto rounded-lg border bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">
        Pending Decisions
      </h3>
      {decisions.length === 0 ? (
        <p className="text-xs text-gray-400">No pending decisions</p>
      ) : (
        <div className="space-y-2">
          {decisions.slice(0, 8).map((d) => (
            <button
              key={d.id}
              onClick={() => onSelectDecision?.(d.id)}
              className="w-full rounded border p-3 text-left transition-colors hover:border-blue-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-blue-700 dark:hover:bg-gray-800/50"
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${levelBadge(d.level)}`}
                >
                  {d.level}
                </span>
                <span className="truncate text-sm font-medium text-gray-700 dark:text-gray-300">
                  {d.title}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-gray-400">
                {d.description?.slice(0, 100)}
              </div>
              <div className="mt-2 flex gap-1">
                {d.options?.slice(0, 3).map((opt: any) => (
                  <span
                    key={opt.id}
                    className="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                  >
                    {opt.label}
                  </span>
                ))}
                {(d.options?.length ?? 0) > 3 && (
                  <span className="text-[10px] text-gray-400">+{d.options!.length - 3} more</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
