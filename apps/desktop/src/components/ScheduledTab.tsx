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
}

export function ScheduledTab({ isDark }: Props) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [prompt, setPrompt] = useState('');
  const [recurring, setRecurring] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchTasks = async () => {
    try {
      const res = await apiFetch('/api/scheduled-tasks');
      if (res.ok) setTasks((await res.json()).tasks ?? []);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchTasks(); }, []);

  const handleCreate = async () => {
    if (!name || !cron || !prompt) return;
    setLoading(true);
    try {
      await apiFetch('/api/scheduled-tasks', {
        method: 'POST', headers: authJsonHeaders(),
        body: JSON.stringify({ name, cron, prompt, recurring }),
      });
      setShowForm(false); setName(''); setCron('0 9 * * *'); setPrompt('');
      fetchTasks();
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/scheduled-tasks/${id}`, { method: 'DELETE', headers: authJsonHeaders() });
    fetchTasks();
  };

  const handleRun = async (id: string) => {
    await apiFetch(`/api/scheduled-tasks/${id}/run`, { method: 'POST', headers: authJsonHeaders() });
    fetchTasks();
  };

  const bg = isDark ? 'bg-gray-800' : 'bg-white';
  const border = isDark ? 'border-gray-700' : 'border-gray-200';
  const inputBg = isDark ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900';
  const text = isDark ? 'text-gray-200' : 'text-gray-800';
  const sub = isDark ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className={`text-lg font-semibold ${text}`}>Scheduled Tasks</h2>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
          <Plus size={14} /> New Task
        </button>
      </div>

      {/* Task list */}
      {tasks.length === 0 ? (
        <p className={sub}>No scheduled tasks. Create one to automate recurring prompts.</p>
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
                  <button onClick={() => handleRun(t.id)} className={`rounded p-1 ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`} title="Run now"><Clock size={14} /></button>
                  <button onClick={() => handleDelete(t.id)} className={`rounded p-1 ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'} text-red-500`}><Trash2 size={14} /></button>
                </div>
              </div>
              <p className={`text-xs mt-1 ${sub} truncate`}>{t.prompt.slice(0, 120)}</p>
              <div className={`text-xs mt-1 ${sub}`}>
                {t.lastRunAt ? `Last: ${new Date(t.lastRunAt).toLocaleString()}` : 'Never run'}
                {t.nextRunAt ? ` · Next: ${new Date(t.nextRunAt).toLocaleString()}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowForm(false)}>
          <div className={`rounded-xl border ${border} ${bg} p-6 w-full max-w-md shadow-2xl`} onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-lg font-semibold mb-4 ${text}`}>New Scheduled Task</h3>
            <div className="space-y-3">
              <input className={`w-full rounded border ${border} ${inputBg} px-3 py-2 text-sm`} placeholder="Task name" value={name} onChange={(e) => setName(e.target.value)} />
              <div>
                <label className={`text-xs ${sub}`}>Cron Expression</label>
                <select className={`w-full rounded border ${border} ${inputBg} px-3 py-2 text-sm mt-1`} value={cron} onChange={(e) => setCron(e.target.value)}>
                  <option value="0 * * * *">Every hour</option>
                  <option value="0 9 * * *">Every day at 9 AM</option>
                  <option value="0 9 * * 1-5">Weekdays at 9 AM</option>
                  <option value="*/30 * * * *">Every 30 minutes</option>
                  <option value="0 0 * * 0">Weekly on Sunday</option>
                </select>
              </div>
              <textarea className={`w-full rounded border ${border} ${inputBg} px-3 py-2 text-sm`} rows={3} placeholder="Prompt to execute..." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
                <span className={sub}>Recurring</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowForm(false)} className={`rounded px-3 py-1.5 text-sm border ${border}`}>Cancel</button>
              <button onClick={handleCreate} disabled={loading} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
