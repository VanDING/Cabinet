import { useState, useEffect } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Clock } from 'lucide-react';
import { apiFetch, authJsonHeaders } from '../utils/pin.js';

interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  prompt: string;
  recurring: boolean;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

interface Props {
  isDark?: boolean;
  showForm?: boolean;
  onFormClose?: () => void;
}

export function ScheduledTab({ isDark, showForm = false, onFormClose }: Props) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [prompt, setPrompt] = useState('');
  const [recurring, setRecurring] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchTasks = async () => {
    try {
      const res = await apiFetch('/api/scheduled-tasks');
      if (res.ok) setTasks((await res.json()).tasks ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleCreate = async () => {
    if (!name || !cron || !prompt) return;
    setLoading(true);
    try {
      await apiFetch('/api/scheduled-tasks', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ name, cron, prompt, recurring }),
      });
      onFormClose?.();
      setName('');
      setCron('0 9 * * *');
      setPrompt('');
      fetchTasks();
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/scheduled-tasks/${id}`, { method: 'DELETE', headers: authJsonHeaders() });
    fetchTasks();
  };

  const handleRun = async (id: string) => {
    await apiFetch(`/api/scheduled-tasks/${id}/run`, {
      method: 'POST',
      headers: authJsonHeaders(),
    });
    fetchTasks();
  };

  const bg = isDark ? 'bg-gray-800' : 'bg-white';
  const border = isDark ? 'border-gray-700' : 'border-gray-200';
  const inputBg = isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900';
  const text = isDark ? 'text-gray-200' : 'text-gray-800';
  const sub = isDark ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="space-y-4">
      {/* Task list */}
      {tasks.length === 0 ? (
        <div className="py-24 text-center text-gray-400 dark:text-gray-500">
          <p className="text-lg">No scheduled tasks</p>
          <p className="mt-1 text-sm">Click "+ New Task" to create one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className={`rounded-lg border ${border} ${bg} p-3`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={`font-medium ${text}`}>{t.name}</span>
                  <span className={`ml-2 text-xs ${sub}`}>{t.cronExpression}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRun(t.id)}
                    className={`rounded p-1 ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                    title="Run now"
                  >
                    <Clock size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className={`rounded p-1 ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'} text-red-500`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className={`mt-1 text-xs ${sub} truncate`}>{t.prompt.slice(0, 120)}</p>
              <div className={`mt-1 text-xs ${sub}`}>
                {t.lastRunAt ? `Last: ${new Date(t.lastRunAt).toLocaleString()}` : 'Never run'}
                {t.nextRunAt ? ` · Next: ${new Date(t.nextRunAt).toLocaleString()}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create form modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={onFormClose}
        >
          <div
            className={`rounded-xl border ${border} ${bg} w-full max-w-md p-6 shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={`mb-4 text-lg font-semibold ${text}`}>New Scheduled Task</h3>
            <div className="space-y-3">
              <input
                className={`w-full rounded border ${border} ${inputBg} px-3 py-2 text-sm`}
                placeholder="Task name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div>
                <label className={`text-xs ${sub}`}>Cron Expression</label>
                <select
                  className={`w-full rounded border ${border} ${inputBg} mt-1 px-3 py-2 text-sm`}
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                >
                  <option value="0 * * * *">Every hour</option>
                  <option value="0 9 * * *">Every day at 9 AM</option>
                  <option value="0 9 * * 1-5">Weekdays at 9 AM</option>
                  <option value="*/30 * * * *">Every 30 minutes</option>
                  <option value="0 0 * * 0">Weekly on Sunday</option>
                </select>
              </div>
              <textarea
                className={`w-full rounded border ${border} ${inputBg} px-3 py-2 text-sm`}
                rows={3}
                placeholder="Prompt to execute..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                />
                <span className={sub}>Recurring</span>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onFormClose}
                className={`rounded border px-3 py-1.5 text-sm ${border}`}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
