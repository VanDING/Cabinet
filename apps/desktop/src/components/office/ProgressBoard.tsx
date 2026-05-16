import { useState, useEffect } from 'react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

interface ProgressTask {
  id: string; title: string; description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  startedAt?: string; completedAt?: string;
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

export function ProgressBoard() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProgress = () => {
    apiFetch('/api/progress?sessionId=default&projectId=default', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProgress(); }, []);

  const updateStatus = async (taskId: string, status: string) => {
    await apiFetch('/api/progress', {
      method: 'POST',
      headers: authJsonHeaders(),
      body: JSON.stringify({ action: 'update', task: { id: taskId, status } }),
    });
    fetchProgress();
  };

  const statusIcon = (s: string) =>
    s === 'completed' ? '✅' : s === 'in_progress' ? '🔄' :
    s === 'blocked' ? '🚫' : s === 'cancelled' ? '❌' : '⏳';

  const statusColor = (s: string) =>
    s === 'completed' ? 'text-green-700 bg-green-50 dark:bg-green-900 dark:text-green-300' :
    s === 'in_progress' ? 'text-blue-700 bg-blue-50 dark:bg-blue-900 dark:text-blue-300' :
    s === 'blocked' ? 'text-red-700 bg-red-50 dark:bg-red-900 dark:text-red-300' :
    'text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-300';

  if (loading) {
    return (
      <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex items-center justify-center">
        <span className="text-xs text-gray-400">Loading progress...</span>
      </div>
    );
  }

  if (!data || data.tasks.length === 0) {
    return (
      <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Task Board</div>
        <p className="text-xs text-gray-400">No tasks tracked yet. Use the secretary to create tasks.</p>
        <button onClick={fetchProgress} className="mt-2 text-xs text-blue-500 hover:underline">Refresh</button>
      </div>
    );
  }

  return (
    <div className="h-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-4 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Task Board</div>
        <button onClick={fetchProgress} className="text-xs text-blue-500 hover:underline">Refresh</button>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{data.stats.completed}/{data.stats.total} done</span>
          <span>{data.percent}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5">
          <div className="h-1.5 rounded-full bg-blue-500 transition-all"
            style={{ width: `${data.percent}%` }} />
        </div>
      </div>

      {/* Next task */}
      {data.nextTask && (
        <div className="mb-3 p-2 border border-blue-200 dark:border-blue-800 rounded bg-blue-50 dark:bg-blue-900/20">
          <div className="text-[10px] text-blue-500 font-medium uppercase">Next Up</div>
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{data.nextTask.title}</div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {data.tasks.map(task => (
          <div key={task.id} className="flex items-center gap-2 group hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded px-1 py-1">
            <span className="text-sm">{statusIcon(task.status)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{task.title}</div>
              {task.blockedReason && (
                <div className="text-[10px] text-red-500">{task.blockedReason}</div>
              )}
            </div>
            {/* Quick actions */}
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {task.status === 'pending' && (
                <button onClick={() => updateStatus(task.id, 'in_progress')}
                  className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  title="Start">▶</button>
              )}
              {task.status === 'in_progress' && (
                <>
                  <button onClick={() => updateStatus(task.id, 'completed')}
                    className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded hover:bg-green-200"
                    title="Complete">✓</button>
                  <button onClick={() => updateStatus(task.id, 'blocked')}
                    className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200"
                    title="Block">✗</button>
                </>
              )}
              {task.status === 'blocked' && (
                <button onClick={() => updateStatus(task.id, 'in_progress')}
                  className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  title="Unblock">↩</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
