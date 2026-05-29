import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../../utils/pin.js';
import { getBufferedEvents } from '../../utils/eventBuffer.js';
import { FileText } from 'lucide-react';

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
  projectId?: string;
  onExpand?: () => void;
}

export function Deliverables({ projectId, onExpand }: Props) {
  const [items, setItems] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDeliverables = useCallback(() => {
    const url = projectId ? `/api/projects/${projectId}/deliverables` : '/api/deliverables';
    apiFetch(url, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => setItems((data.deliverables ?? []).slice(0, 5)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleOpenDeliverable = (d: Deliverable) => {
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
  };

  useEffect(() => {
    fetchDeliverables();
  }, [fetchDeliverables]);

  useEffect(() => {
    const handler = () => fetchDeliverables();
    window.addEventListener('ws:deliverable_created', handler);
    window.addEventListener('ws:workflow_completed', handler);
    window.addEventListener('ws:meeting_created', handler);

    const buffered = getBufferedEvents();
    const hasRelevant = buffered.some((e) =>
      ['deliverable_created', 'workflow_completed', 'meeting_created'].includes(e.type),
    );
    if (hasRelevant) fetchDeliverables();

    return () => {
      window.removeEventListener('ws:deliverable_created', handler);
      window.removeEventListener('ws:workflow_completed', handler);
      window.removeEventListener('ws:meeting_created', handler);
    };
  }, [fetchDeliverables]);

  const text = 'text-content-primary';
  const sub = 'text-content-tertiary';

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-sm">
      <div className="mb-3 flex cursor-pointer items-center justify-between" onClick={onExpand}>
        <span className="text-sm font-medium text-content-secondary">Deliverables</span>
        {items.length > 0 && (
          <span className="text-xs text-accent hover:underline">View all</span>
        )}
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          Loading...
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          No deliverables yet
          <span className="mt-1 block text-[10px] text-content-tertiary">
            Meeting reports and workflow outputs appear here
          </span>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-auto">
          {items.map((d) => (
            <div
              key={d.id}
              className={`flex cursor-pointer items-center gap-2 text-xs ${d.filePath || d.meetingId ? 'hover:opacity-80' : ''}`}
              onClick={() => handleOpenDeliverable(d)}
            >
              <FileText size={12} className="flex-shrink-0 text-content-tertiary" />
              <span className={`truncate ${text}`}>{d.title}</span>
              <span className={`ml-auto flex-shrink-0 ${sub}`}>
                {new Date(d.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
