import { memo } from 'react';
import type { Decision } from '@cabinet/types';
import { useDecisions } from '../../hooks/useDecisions';
import { useEvent } from '../../hooks/useEvent';

interface Props {
  onSelectDecision?: (id: string) => void;
  projectId?: string;
}

export const DecisionList = memo(function DecisionList({ onSelectDecision, projectId }: Props) {
  const { data: decisions = [], isLoading, refetch } = useDecisions(projectId);

  useEvent('decision_created', () => refetch());
  useEvent('decision_updated', () => refetch());

  const pending = decisions.filter((d: Decision) => d.status === 'pending');
  const resolved = decisions.filter((d: Decision) => d.status !== 'pending').slice(0, 4);

  const text = 'text-content-primary';
  const sub = 'text-content-tertiary';

  if (isLoading) {
    return (
      <div className="flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-content-secondary">Decisions</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-content-secondary">Decisions</span>
        {pending.length > 0 && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-white">
            {pending.length} pending
          </span>
        )}
      </div>
      {pending.length === 0 && resolved.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          No decisions yet
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-auto">
          {pending.length > 0 && (
            <div>
              <span className="mb-1 block text-xs font-medium text-accent">Pending</span>
              <div className="space-y-1">
                {pending.map((d) => (
                  <div
                    key={d.id}
                    className="cursor-pointer rounded-md border border-accent/20 bg-accent/5 p-2 hover:bg-accent/10"
                    onClick={() => onSelectDecision?.(d.id)}
                  >
                    <div className={`text-xs font-medium ${text}`}>{d.title}</div>
                    <div className={`mt-0.5 text-[10px] ${sub}`}>{d.description?.slice(0, 60)}...</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {resolved.length > 0 && (
            <div>
              <span className="mb-1 block text-xs font-medium text-content-secondary">Recent</span>
              <div className="space-y-1">
                {resolved.map((d) => (
                  <div
                    key={d.id}
                    className="cursor-pointer rounded-md border border-border p-2 hover:bg-surface-elevated"
                    onClick={() => onSelectDecision?.(d.id)}
                  >
                    <div className={`text-xs ${sub}`}>{d.title}</div>
                    <div className="mt-0.5 text-[10px] text-content-secondary">
                      {d.status} · {new Date(d.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
