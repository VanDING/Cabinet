import { useState, useEffect, useCallback } from 'react';
import { X, FileText } from 'lucide-react';
import { apiFetch, authHeaders } from '../../utils/pin.js';

interface Deliverable {
  id: string;
  projectId: string;
  title: string;
  type: string;
  filePath?: string;
  meetingId?: string;
  tags: string[];
  createdAt: string;
}

interface Props {
  onClose: () => void;
  projectId?: string;
}

export function DeliverablesModal({ onClose, projectId }: Props) {
  const [items, setItems] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeliverables = useCallback(() => {
    const url = projectId ? `/api/projects/${projectId}/deliverables` : '/api/deliverables';
    apiFetch(url, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => setItems(data.deliverables ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchDeliverables();
  }, [fetchDeliverables]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleOpen = (d: Deliverable) => {
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
    } else if (d.meetingId) {
      window.dispatchEvent(
        new CustomEvent('open-file-viewer', {
          detail: {
            path: `meeting:${d.meetingId}`,
            name: d.title,
            mimeType: 'text/markdown',
            projectId: d.projectId,
          },
        }),
      );
    }
    onClose();
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case 'meeting_report': return 'Report';
      case 'workflow_output': return 'Output';
      case 'document': return 'Doc';
      case 'code': return 'Code';
      default: return type;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h3 className="text-lg font-semibold text-content-primary">Deliverables</h3>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-content-tertiary hover:text-content-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-content-tertiary">
            No deliverables yet
          </div>
        ) : (
          <div className="overflow-y-auto px-5 pb-4">
            <div className="space-y-1">
              {items.map((d) => (
                <button
                  key={d.id}
                  onClick={() => handleOpen(d)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-muted"
                >
                  <FileText size={14} className="shrink-0 text-content-tertiary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-content-primary">{d.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-content-tertiary">
                      <span>{typeLabel(d.type)}</span>
                      {d.tags.length > 0 && (
                        <span>{d.tags.join(', ')}</span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-content-tertiary">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
