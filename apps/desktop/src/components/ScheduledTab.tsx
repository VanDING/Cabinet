import { useState, useEffect } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Clock } from 'lucide-react';
import { apiFetch, authJsonHeaders } from '../utils/pin.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [min, hour, dom, month, dow] = parts as string[];

  // Every minute
  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'Every minute';
  }

  // Every hour at minute 0
  if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'Every hour';
  }

  // Every N minutes
  if (min!.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const interval = parseInt(min!.slice(2), 10);
    if (!isNaN(interval)) return `Every ${interval} min`;
  }

  // Specific time: 0 HH * * * → "HH:00 daily"
  if (dom === '*' && month === '*' && dow === '*') {
    if (min === '0' || /^\d+$/.test(min!)) {
      const h = parseInt(hour!, 10);
      const m = parseInt(min!, 10);
      if (!isNaN(h) && !isNaN(m)) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} daily`;
      }
    }
  }

  // Day-of-week patterns
  const dayLabel = (() => {
    if (dow === '1-5') return 'weekdays';
    if (dow === '0') return 'Sundays';
    if (dow === '1') return 'Mondays';
    const d = parseInt(dow!, 10);
    if (!isNaN(d) && d >= 0 && d <= 6 && dom === '*' && month === '*') return DAY_NAMES[d] + 's';
    return null;
  })();

  if (dayLabel && (min === '0' || /^\d+$/.test(min!))) {
    const h = parseInt(hour!, 10);
    const m = parseInt(min!, 10);
    if (!isNaN(h) && !isNaN(m)) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}, ${dayLabel}`;
    }
  }

  // Fallback
  return expr;
}

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
  showForm?: boolean;
  onFormClose?: () => void;
}

export function ScheduledTab({ showForm = false, onFormClose }: Props) {
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

  const cardClasses =
    'rounded-lg border border-border bg-surface-primary shadow-sm';
  const inputClasses =
    'rounded border border-border bg-surface-elevated px-3 py-2 text-sm text-content-primary';
  const textClasses = 'text-content-primary';
  const subClasses = 'text-content-tertiary';

  return (
    <div className="space-y-4">
      {tasks.length === 0 ? (
        <div className="py-24 text-center text-content-tertiary">
          <p className="text-lg">No scheduled tasks</p>
          <p className="mt-1 text-sm">Click &quot;+ New Task&quot; to create one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.id} className={`${cardClasses} p-3`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={`font-medium ${textClasses}`}>{t.name}</span>
                  <span className={`ml-2 text-xs ${subClasses}`}>{formatCron(t.cronExpression)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRun(t.id)}
                    className="rounded p-1 hover:bg-surface-muted bg-surface-input"
                    title="Run now"
                  >
                    <Clock size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="rounded p-1 text-intent-danger hover:bg-surface-muted bg-surface-input"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className={`mt-1 truncate text-xs ${subClasses}`}>{t.prompt.slice(0, 120)}</p>
              <div className={`mt-1 text-xs ${subClasses}`}>
                {t.lastRunAt ? `Last: ${new Date(t.lastRunAt).toLocaleString()}` : 'Never run'}
                {t.nextRunAt ? ` · Next: ${new Date(t.nextRunAt).toLocaleString()}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={onFormClose}
        >
          <div
            className={`${cardClasses} w-full max-w-md rounded-xl p-6 shadow-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={`mb-4 text-lg font-semibold ${textClasses}`}>New Scheduled Task</h3>
            <div className="space-y-3">
              <input
                className={`w-full ${inputClasses}`}
                placeholder="Task name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div>
                <label className={`text-xs ${subClasses}`}>Cron Expression</label>
                <select
                  className={`mt-1 w-full ${inputClasses}`}
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
                className={`w-full ${inputClasses}`}
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
                <span className={subClasses}>Recurring</span>
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onFormClose}
                className="rounded border border-border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="rounded bg-accent px-3 py-1.5 text-sm text-content-inverse hover:bg-accent-hover"
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
