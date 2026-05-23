import { useState, useEffect, useCallback, memo } from 'react';
import type { Decision } from '@cabinet/types';
import { useToast } from '../Toast';
import { apiFetch, authHeaders } from '../../utils/pin.js';
import { getBufferedEvents } from '../../utils/eventBuffer.js';

interface Props {
  onSelectDecision?: (id: string) => void;
  projectId?: string;
}

export const DecisionList = memo(function DecisionList({ onSelectDecision, projectId }: Props) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams({ status: 'pending' });
    if (projectId) params.set('projectId', projectId);
    return `/api/decisions?${params.toString()}`;
  }, [projectId]);

  const fetchDecisions = useCallback(() => {
    apiFetch(buildUrl(), { headers: authHeaders() })
      .then((res) => res.json())
      .then((data) => {
        if (data.decisions) setDecisions(data.decisions);
      })
      .catch(() => {
        addToast('error', 'Failed to load decisions');
      })
      .finally(() => setLoading(false));
  }, [addToast, buildUrl]);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);

  // Listen for WebSocket decision updates
  useEffect(() => {
    const handleUpdate = () => fetchDecisions();
    window.addEventListener('ws:decision_created', handleUpdate);
    window.addEventListener('ws:decision_updated', handleUpdate);

    // Replay buffered events that arrived before mount
    const buffered = getBufferedEvents();
    const hasRelevant = buffered.some((e) => e.type === 'decision_created' || e.type === 'decision_updated');
    if (hasRelevant) fetchDecisions();

    return () => {
      window.removeEventListener('ws:decision_created', handleUpdate);
      window.removeEventListener('ws:decision_updated', handleUpdate);
    };
  }, [fetchDecisions]);

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
      {loading ? (
        <p className="text-xs text-gray-400">Loading...</p>
      ) : decisions.length === 0 ? (
        <>
          <p className="text-xs text-gray-400">No pending decisions</p>
          <p className="mt-1 text-xs text-gray-400">Agents create decisions during meetings and task execution</p>
        </>
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
