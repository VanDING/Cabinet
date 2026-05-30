import { useState, useEffect, useCallback } from 'react';
import { Clock, RefreshCw, CheckCircle2, XCircle, Play, Check, Ban, RotateCcw } from 'lucide-react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';
import { getBufferedEvents } from '../../utils/eventBuffer.js';

interface ProgressTask {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  dependencies?: string[];
}

interface ProgressData {
  stats: { total: number; completed: number; inProgress: number; pending: number; blocked: number };
  percent: number;
  tasks: ProgressTask[];
  nextTask: ProgressTask | null;
  notes: string[];
}

interface Props {
  projectId?: string;
}

export function ProgressBoard({ projectId }: Props) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProgress = useCallback(() => {
    const pid = projectId ?? 'default';
    apiFetch(`/api/progress?sessionId=default&projectId=${encodeURIComponent(pid)}`, {
      headers: authHeaders(),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setData(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  useEffect(() => {
    const handler = () => fetchProgress();
    window.addEventListener('ws:task_updated', handler);
    window.addEventListener('ws:task_created', handler);

    // Replay buffered events that arrived before mount
    const buffered = getBufferedEvents();
    const hasRelevant = buffered.some(
      (e) => e.type === 'task_updated' || e.type === 'task_created',
    );
    if (hasRelevant) fetchProgress();

    return () => {
      window.removeEventListener('ws:task_updated', handler);
      window.removeEventListener('ws:task_created', handler);
    };
  }, [fetchProgress]);

  const updateStatus = async (taskId: string, status: string) => {
    await apiFetch('/api/progress', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ action: 'update', task: { id: taskId, status } }),
    });
    fetchProgress();
  };

  const StatusIcon = ({ status }: { status: string }) => {
    const cls = 'h-3.5 w-3.5';
    switch (status) {
      case 'completed': return <CheckCircle2 className={`${cls} text-intent-success`} />;
      case 'in_progress': return <RefreshCw className={`${cls} text-accent`} />;
      case 'blocked': return <XCircle className={`${cls} text-intent-danger`} />;
      case 'cancelled': return <XCircle className={`${cls} text-content-tertiary`} />;
      default: return <Clock className={`${cls} text-content-tertiary`} />;
    }
  };

  const statusColor = (s: string) =>
    s === 'completed'
      ? 'text-intent-success bg-intent-success-muted'
      : s === 'in_progress'
        ? 'text-accent bg-accent-muted'
        : s === 'blocked'
          ? 'text-intent-danger bg-intent-danger-muted'
          : 'text-content-secondary bg-surface-muted';

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
        <span className="text-xs text-content-tertiary">Loading progress...</span>
      </div>
    );
  }

  if (!data || data.tasks.length === 0) {
    return (
      <div className="h-full rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
        <div className="mb-2 text-sm font-medium text-content-secondary">Task Board</div>
        <p className="text-xs text-content-tertiary">
          No tasks tracked yet. Use the secretary to create tasks.
        </p>
        <button onClick={fetchProgress} className="mt-2 text-xs text-accent hover:underline">
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-primary shadow-xs p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-content-secondary">Task Board</div>
        <button onClick={fetchProgress} className="text-xs text-accent hover:underline">
          Refresh
        </button>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-xs text-content-tertiary">
          <span>
            {data.stats.completed}/{data.stats.total} done
          </span>
          <span>{data.percent}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-surface-muted">
          <div
            className="h-1.5 rounded-full bg-accent transition-all"
            style={{ width: `${data.percent}%` }}
          />
        </div>
      </div>

      {/* Next task */}
      {data.nextTask && (
        <div className="mb-3 rounded-sm border border-accent bg-accent-muted p-2">
          <div className="text-[10px] font-medium uppercase text-accent">Next Up</div>
          <div className="text-sm font-medium text-content-primary">
            {data.nextTask.title}
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {data.tasks.map((task) => (
          <div
            key={task.id}
            className="group flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-surface-elevated bg-surface-input/50"
          >
            <StatusIcon status={task.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-content-primary">
                {task.title}
              </div>
              {task.blockedReason && (
                <div className="text-[10px] text-intent-danger">{task.blockedReason}</div>
              )}
            </div>
            {/* Quick actions */}
            <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {task.status === 'pending' && (
                <button
                  onClick={() => updateStatus(task.id, 'in_progress')}
                  className="rounded-sm bg-accent-muted p-0.5 text-accent hover:bg-accent"
                  title="Start"
                >
                  <Play size={12} />
                </button>
              )}
              {task.status === 'in_progress' && (
                <>
                  <button
                    onClick={() => updateStatus(task.id, 'completed')}
                    className="rounded-sm bg-intent-success-muted p-0.5 text-intent-success hover:bg-intent-success"
                    title="Complete"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={() => updateStatus(task.id, 'blocked')}
                    className="rounded-sm bg-intent-danger-muted p-0.5 text-intent-danger hover:bg-intent-danger"
                    title="Block"
                  >
                    <Ban size={12} />
                  </button>
                </>
              )}
              {task.status === 'blocked' && (
                <button
                  onClick={() => updateStatus(task.id, 'in_progress')}
                  className="rounded-sm bg-accent-muted p-0.5 text-accent hover:bg-accent"
                  title="Unblock"
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
