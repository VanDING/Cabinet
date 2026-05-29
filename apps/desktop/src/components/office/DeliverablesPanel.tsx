import { useState, useEffect } from 'react';
import { X, FileText, Trash2, Tag } from 'lucide-react';
import { apiFetch, authHeaders, authJsonHeaders } from '../../utils/pin.js';

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
  onClose: () => void;
}

export function DeliverablesPanel({ projectId, onClose }: Props) {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/deliverables`, {
        headers: authHeaders(),
      });
      if (res.ok) setDeliverables((await res.json()).deliverables ?? []);
    } catch {
      /* ignore */
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [projectId]);

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/projects/${projectId}/deliverables/${id}`, {
      method: 'DELETE',
      headers: authJsonHeaders(),
    });
    fetchData();
  };

  const types = [...new Set(deliverables.map((d) => d.type))];
  const filtered =
    filter === 'all' ? deliverables : deliverables.filter((d) => d.type === filter);

  const border = 'border-border';
  const bg = 'bg-surface-primary';
  const text = 'text-content-primary';
  const sub = 'text-content-tertiary';
  const typeColors: Record<string, string> = {
    meeting_report: 'bg-accent-muted text-accent',
    general: 'bg-surface-muted text-content-secondary',
  };

  return (
    <div
      className={`fixed inset-y-0 right-0 z-40 w-full max-w-xl border-l ${border} ${bg} flex flex-col shadow-2xl`}
    >
      <div className={`flex items-center justify-between border-b p-4 ${border}`}>
        <h2 className={`text-lg font-semibold ${text}`}>Deliverables</h2>
        <button onClick={onClose} className="rounded p-1 hover:bg-surface-muted:bg-surface-input">
          <X size={18} />
        </button>
      </div>

      {/* Type filter */}
      {types.length > 1 && (
        <div className={`flex gap-1 overflow-x-auto border-b px-4 py-2 ${border}`}>
          <button
            onClick={() => setFilter('all')}
            className={`rounded-full px-2 py-0.5 text-xs ${filter === 'all' ? 'bg-accent text-content-inverse' : `${sub} border ${border}`}`}
          >
            All
          </button>
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`rounded-full px-2 py-0.5 text-xs capitalize ${filter === t ? 'bg-accent text-content-inverse' : `${sub} border ${border}`}`}
            >
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-auto p-4">
        {loading ? (
          <p className={sub}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p className={sub}>
            No deliverables yet. They are auto-created when meetings or workflows complete.
          </p>
        ) : (
          filtered.map((d) => (
            <div
              key={d.id}
              className={`cursor-pointer rounded-lg border ${border} bg-surface-elevated p-3 hover:opacity-90`}
              onClick={() => {
                if (d.filePath) {
                  window.dispatchEvent(
                    new CustomEvent('open-file-viewer', {
                      detail: {
                        path: d.filePath,
                        name: d.title,
                        mimeType: d.type === 'meeting_report' ? 'text/markdown' : undefined,
                        projectId: d.projectId,
                      },
                    }),
                  );
                }
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2">
                  <FileText size={16} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <span className={`text-sm font-medium ${text}`}>{d.title}</span>
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${typeColors[d.type] ?? 'bg-surface-muted text-content-secondary'}`}
                    >
                      {d.type.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(d.id);
                  }}
                  className="rounded p-1 text-intent-danger hover:bg-surface-muted:bg-surface-input"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className={`mt-2 flex items-center gap-2 text-xs ${sub}`}>
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
