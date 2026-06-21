import { useState, useEffect, useCallback } from 'react';
import { Clock, RefreshCw, CheckCircle2, XCircle, Play, Check, Ban, RotateCcw } from 'lucide-react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/api.js';
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
      .catch((err) => {
        console.warn('Operation failed', err);
      })
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
      case 'completed':
        return <CheckCircle2 className={`${cls} text-intent-success`} />;
      case 'in_progress':
        return <RefreshCw className={`${cls} text-accent`} />;
      case 'blocked':
        return <XCircle className={`${cls} text-intent-danger`} />;
      case 'cancelled':
        return <XCircle className={`${cls} text-content-tertiary`} />;
      default:
        return <Clock className={`${cls} text-content-tertiary`} />;
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
      <div className="border-border bg-surface-primary flex h-full items-center justify-center rounded-lg border p-4 shadow-xs">
        <span className="text-content-tertiary text-xs">Loading progress...</span>
      </div>
    );
  }

  if (!data || data.tasks.length === 0) {
    return (
      <div className="border-border bg-surface-primary h-full rounded-lg border p-4 shadow-xs">
        <div className="text-content-secondary mb-2 text-sm font-medium">Task Board</div>
        <p className="text-content-tertiary text-xs">
          No tasks tracked yet. Use the secretary to create tasks.
        </p>
        <button onClick={fetchProgress} className="text-accent mt-2 text-xs hover:underline">
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="border-border bg-surface-primary flex h-full flex-col overflow-hidden rounded-lg border p-4 shadow-xs">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-content-secondary text-sm font-medium">Task Board</div>
        <button onClick={fetchProgress} className="text-accent text-xs hover:underline">
          Refresh
        </button>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="text-content-tertiary mb-1 flex justify-between text-xs">
          <span>
            {data.stats.completed}/{data.stats.total} done
          </span>
          <span>{data.percent}%</span>
        </div>
        <div className="bg-surface-muted h-1.5 w-full rounded-full">
          <div
            className="bg-accent h-1.5 rounded-full transition-all"
            style={{ width: `${data.percent}%` }}
          />
        </div>
      </div>

      {/* Next task */}
      {data.nextTask && (
        <div className="border-accent bg-accent-muted mb-3 rounded-sm border p-2">
          <div className="text-accent text-[10px] font-medium uppercase">Next Up</div>
          <div className="text-content-primary text-sm font-medium">{data.nextTask.title}</div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 space-y-1 overflow-y-auto">
        {data.tasks.map((task) => (
          <div
            key={task.id}
            className="group hover:bg-surface-elevated bg-surface-input/50 flex items-center gap-2 rounded-sm px-1 py-1"
          >
            <StatusIcon status={task.status} />
            <div className="min-w-0 flex-1">
              <div className="text-content-primary truncate text-xs font-medium">{task.title}</div>
              {task.blockedReason && (
                <div className="text-intent-danger text-[10px]">{task.blockedReason}</div>
              )}
            </div>
            {/* Quick actions */}
            <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {task.status === 'pending' && (
                <button
                  onClick={() => updateStatus(task.id, 'in_progress')}
                  className="bg-accent-muted text-accent hover:bg-accent rounded-sm p-0.5"
                  title="Start"
                >
                  <Play size={12} />
                </button>
              )}
              {task.status === 'in_progress' && (
                <>
                  <button
                    onClick={() => updateStatus(task.id, 'completed')}
                    className="bg-intent-success-muted text-intent-success hover:bg-intent-success rounded-sm p-0.5"
                    title="Complete"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={() => updateStatus(task.id, 'blocked')}
                    className="bg-intent-danger-muted text-intent-danger hover:bg-intent-danger rounded-sm p-0.5"
                    title="Block"
                  >
                    <Ban size={12} />
                  </button>
                </>
              )}
              {task.status === 'blocked' && (
                <button
                  onClick={() => updateStatus(task.id, 'in_progress')}
                  className="bg-accent-muted text-accent hover:bg-accent rounded-sm p-0.5"
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
