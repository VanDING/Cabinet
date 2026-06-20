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
      <div className="border-border bg-surface-primary flex h-full flex-col rounded-lg border p-4 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-content-secondary text-sm font-medium">Decisions</span>
        </div>
        <div className="text-content-tertiary flex flex-1 items-center justify-center text-xs">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="border-border bg-surface-primary flex h-full flex-col rounded-lg border p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-content-secondary text-sm font-medium">Decisions</span>
        {pending.length > 0 && (
          <span className="bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-xs">
            {pending.length} pending
          </span>
        )}
      </div>
      {pending.length === 0 && resolved.length === 0 ? (
        <div className="text-content-tertiary flex flex-1 items-center justify-center text-xs">
          No decisions yet
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-auto">
          {pending.length > 0 && (
            <div>
              <span className="text-accent mb-1 block text-xs font-medium">Pending</span>
              <div className="space-y-1">
                {pending.map((d) => (
                  <div
                    key={d.id}
                    className="border-accent/20 bg-accent/5 hover:bg-accent/10 cursor-pointer rounded-md border p-2"
                    onClick={() => onSelectDecision?.(d.id)}
                  >
                    <div className={`text-xs font-medium ${text}`}>{d.title}</div>
                    <div className={`mt-0.5 text-[10px] ${sub}`}>
                      {d.description?.slice(0, 60)}...
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {resolved.length > 0 && (
            <div>
              <span className="text-content-secondary mb-1 block text-xs font-medium">Recent</span>
              <div className="space-y-1">
                {resolved.map((d) => (
                  <div
                    key={d.id}
                    className="border-border hover:bg-surface-elevated cursor-pointer rounded-md border p-2"
                    onClick={() => onSelectDecision?.(d.id)}
                  >
                    <div className={`text-xs ${sub}`}>{d.title}</div>
                    <div className="text-content-secondary mt-0.5 text-[10px]">
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
