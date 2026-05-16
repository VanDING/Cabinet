import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../components/Toast';
import { apiFetch, authHeaders, authJsonHeaders } from '../utils/pin.js';

interface Meeting {
  meetingId: string;
  topic: string;
  status: string;
  estimatedCost?: number;
  summary?: string;
  attendees?: string[];
  actualCost?: number;
}

export function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [topic, setTopic] = useState('');
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [creating, setCreating] = useState(false);
  const { isDark } = useTheme();
  const { addToast } = useToast();

  const handleCreate = async () => {
    if (!topic.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch('/api/meetings', {
        method: 'POST',
        headers: authJsonHeaders(),
        body: JSON.stringify({ topic: topic.trim() }),
      });
      const data = await res.json();
      setMeetings(prev => [data, ...prev]);
      setSelected(data);
      setTopic('');
      addToast('success', `Meeting "${data.topic}" started`);
    } catch {
      addToast('error', 'Failed to create meeting');
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    apiFetch('/api/meetings', { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { if (d.meetings?.length > 0) setMeetings(d.meetings); })
      .catch(() => { addToast('error', 'Failed to load meetings'); });
  }, [addToast]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Meetings</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">Multi-agent deliberation sessions</span>
        </div>
      </div>

      {/* Create meeting */}
      <div className={`mb-6 border rounded-lg p-4 ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="flex gap-3">
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="Meeting topic..."
            className={`flex-1 border rounded-lg px-3 py-2 text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200 placeholder-gray-400' : 'bg-white border-gray-300 text-gray-700 placeholder-gray-400'}`}
          />
          <button onClick={handleCreate} disabled={creating || !topic.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {creating ? 'Starting...' : 'Start Meeting'}
          </button>
        </div>
      </div>

      {/* Meetings list */}
      <div className="space-y-3">
        {meetings.map(m => (
          <div key={m.meetingId}
            onClick={() => setSelected(selected?.meetingId === m.meetingId ? null : m)}
            className={`border rounded-lg p-4 cursor-pointer transition-all ${
              isDark ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-white border-gray-200 hover:bg-gray-50'
            } ${selected?.meetingId === m.meetingId ? 'ring-2 ring-blue-500' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className={`font-medium text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{m.topic}</h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  ID: {m.meetingId} &middot; Status: {m.status}
                  {m.estimatedCost && <> &middot; Est. cost: ${m.estimatedCost.toFixed(2)}</>}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                m.status === 'started' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                m.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
              }`}>{m.status}</span>
            </div>

            {selected?.meetingId === m.meetingId && (
              <div className="mt-3 pt-3 border-t dark:border-gray-700 space-y-3">
                {(m as any).perspectives && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-500">Advisor Perspectives</p>
                    {(m as any).perspectives.map((p: any, i: number) => (
                      <div key={i} className={`text-xs border-l-2 pl-2 py-1 ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{p.advisor}</span>
                        <span className="text-gray-400 ml-1">({p.role})</span>
                        <p className="text-gray-600 dark:text-gray-400 mt-0.5">{p.content}</p>
                      </div>
                    ))}
                  </div>
                )}
                {(m as any).synthesis && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Synthesis</p>
                    <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{(m as any).synthesis}</p>
                  </div>
                )}
                {(m as any).disagreements?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-500 mb-1">Disagreements</p>
                    {(m as any).disagreements.map((d: string, i: number) => (
                      <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{d}</p>
                    ))}
                  </div>
                )}
                {m.attendees && !(m as any).perspectives && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Attendees</p>
                    <div className="flex gap-1 flex-wrap">
                      {m.attendees.map((a: string) => (
                        <span key={a} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 text-xs">
                  {m.estimatedCost && <span className="text-gray-400">Cost: ${m.estimatedCost.toFixed(2)}</span>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
