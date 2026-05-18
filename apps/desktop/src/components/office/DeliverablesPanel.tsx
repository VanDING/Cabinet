import { useState, useEffect } from 'react';
import { X, FileText, Trash2, Tag } from 'lucide-react';
import { apiFetch, authJsonHeaders } from '../../utils/pin.js';

interface Deliverable {
  id: string;
  projectId: string;
  meetingId?: string;
  title: string;
  type: string;
  filePath?: string;
  tags: string[];
  createdAt: string;
}

interface Props {
  projectId: string;
  isDark?: boolean;
  onClose: () => void;
}

export function DeliverablesPanel({ projectId, isDark, onClose }: Props) {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/deliverables`);
      if (res.ok) setDeliverables((await res.json()).deliverables ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [projectId]);

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/projects/${projectId}/deliverables/${id}`, {
      method: 'DELETE', headers: authJsonHeaders(),
    });
    fetchData();
  };

  const types = [...new Set(deliverables.map((d) => d.type))];
  const filtered = filter === 'all' ? deliverables : deliverables.filter((d) => d.type === filter);

  const border = isDark ? 'border-gray-700' : 'border-gray-200';
  const bg = isDark ? 'bg-gray-900' : 'bg-white';
  const text = isDark ? 'text-gray-200' : 'text-gray-800';
  const sub = isDark ? 'text-gray-400' : 'text-gray-500';
  const typeColors: Record<string, string> = { meeting_report: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', general: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' };

  return (
    <div className={`fixed inset-y-0 right-0 z-40 w-full max-w-xl border-l ${border} ${bg} shadow-2xl flex flex-col`}>
      <div className={`flex items-center justify-between p-4 border-b ${border}`}>
        <h2 className={`text-lg font-semibold ${text}`}>Deliverables</h2>
        <button onClick={onClose} className={`p-1 rounded ${isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}><X size={18} /></button>
      </div>

      {/* Type filter */}
      {types.length > 1 && (
        <div className={`flex gap-1 px-4 py-2 border-b ${border} overflow-x-auto`}>
          <button onClick={() => setFilter('all')} className={`px-2 py-0.5 rounded-full text-xs ${filter === 'all' ? 'bg-blue-600 text-white' : `${sub} border ${border}`}`}>All</button>
          {types.map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={`px-2 py-0.5 rounded-full text-xs capitalize ${filter === t ? 'bg-blue-600 text-white' : `${sub} border ${border}`}`}>{t.replace('_', ' ')}</button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {loading ? (
          <p className={sub}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p className={sub}>No deliverables yet. They are auto-created when meetings or workflows complete.</p>
        ) : (
          filtered.map((d) => (
            <div key={d.id} className={`rounded-lg border ${border} ${isDark ? 'bg-gray-800' : 'bg-gray-50'} p-3`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2">
                  <FileText size={16} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <span className={`text-sm font-medium ${text}`}>{d.title}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${typeColors[d.type] ?? 'bg-gray-100 text-gray-600'}`}>{d.type.replace('_', ' ')}</span>
                  </div>
                </div>
                <button onClick={() => handleDelete(d.id)} className={`p-1 rounded ${isDark ? 'hover:bg-gray-600' : 'hover:bg-gray-200'} text-red-500`}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div className={`flex items-center gap-2 mt-2 text-xs ${sub}`}>
                <span>{new Date(d.createdAt).toLocaleDateString()}</span>
                {d.meetingId && <span>· Meeting: {d.meetingId.slice(0, 12)}...</span>}
                {d.tags.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Tag size={10} />
                    {d.tags.slice(0, 3).join(', ')}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
