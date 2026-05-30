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

  const pending = decisions.filter((d) => d.status === 'pending');
  const resolved = decisions.filter((d) => d.status !== 'pending').slice(0, 4);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams({ status: 'all' });
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
    const hasRelevant = buffered.some(
      (e) => e.type === 'decision_created' || e.type === 'decision_updated',
    );
    if (hasRelevant) fetchDecisions();

    return () => {
      window.removeEventListener('ws:decision_created', handleUpdate);
      window.removeEventListener('ws:decision_updated', handleUpdate);
    };
  }, [fetchDecisions]);

  const levelBadge = (level: string) => {
    const colors: Record<string, string> = {
      L0: 'bg-intent-success-muted text-intent-success',
      L1: 'bg-accent-muted text-accent',
      L2: 'bg-intent-warning-muted text-intent-warning',
      L3: 'bg-intent-danger-muted text-intent-danger',
    };
    return colors[level] ?? 'bg-surface-muted text-content-tertiary';
  };

  const statusBadge = (status: string) => {
    if (status === 'pending')
      return 'bg-intent-warning-muted text-intent-warning';
    if (status === 'approved')
      return 'bg-intent-success-muted text-intent-success';
    if (status === 'rejected')
      return 'bg-intent-danger-muted text-intent-danger';
    return 'bg-surface-muted text-content-tertiary';
  };

  return (
    <div className="h-full overflow-y-auto rounded-lg border border-border bg-surface-primary p-4 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold text-content-secondary">
        Decisions
        {pending.length > 0 && (
          <span className="ml-1.5 rounded-full bg-intent-warning-muted px-1.5 py-0.5 text-[10px] text-intent-warning">
            {pending.length} pending
          </span>
        )}
      </h3>
      {loading ? (
        <p className="text-xs text-content-tertiary">Loading...</p>
      ) : decisions.length === 0 ? (
        <>
          <p className="text-xs text-content-tertiary">No decisions yet</p>
          <p className="mt-1 text-xs text-content-tertiary">
            Agents create decisions during meetings and task execution
          </p>
        </>
      ) : (
        <div className="space-y-2">
          {/* Pending first */}
          {pending.slice(0, 6).map((d) => (
            <button
              key={d.id}
              onClick={() => onSelectDecision?.(d.id)}
              className="w-full rounded border border-border p-3 text-left transition-colors hover:border-accent hover:bg-surface-elevated bg-surface-primary/50"
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${levelBadge(d.level)}`}
                >
                  {d.level}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${statusBadge(d.status)}`}
                >
                  {d.status}
                </span>
                <span className="truncate text-sm font-medium text-content-secondary">
                  {d.title}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-content-tertiary">
                {d.description?.slice(0, 100)}
              </div>
              <div className="mt-2 flex gap-1">
                {d.options?.slice(0, 3).map((opt: any) => (
                  <span
                    key={opt.id}
                    className="rounded bg-surface-muted px-2 py-0.5 text-[10px] text-content-tertiary"
                  >
                    {opt.label}
                  </span>
                ))}
                {(d.options?.length ?? 0) > 3 && (
                  <span className="text-[10px] text-content-tertiary">+{d.options!.length - 3} more</span>
                )}
              </div>
            </button>
          ))}

          {/* Recently resolved */}
          {resolved.length > 0 && (
            <>
              <div className="my-2 border-t border-border" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-content-tertiary">
                Recently resolved
              </p>
              {resolved.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onSelectDecision?.(d.id)}
                  className="w-full rounded border border-border p-2 text-left opacity-70 transition-colors hover:border-accent hover:bg-surface-elevated hover:opacity-100 bg-surface-primary/50"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${statusBadge(d.status)}`}
                    >
                      {d.status}
                    </span>
                    <span className="text-xs font-medium text-content-secondary">
                      {d.title}
                    </span>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
});
