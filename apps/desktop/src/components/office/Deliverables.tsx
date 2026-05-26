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
  isDark?: boolean;
  onExpand?: () => void;
}

export function Deliverables({ projectId, isDark, onExpand }: Props) {
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
      window.dispatchEvent(new CustomEvent('open-file-viewer', {
        detail: { path: d.filePath, name: d.title, mimeType: d.type === 'meeting_report' ? 'text/markdown' : undefined, projectId: d.projectId },
      }));
    } else if (d.meetingId) {
      window.dispatchEvent(new CustomEvent('open-file-viewer', {
        detail: { path: `meeting:${d.meetingId}`, name: d.title, mimeType: 'text/markdown', projectId: d.projectId },
      }));
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

    // Replay buffered events that arrived before mount
    const buffered = getBufferedEvents();
    const hasRelevant = buffered.some((e) =>
      ['deliverable_created', 'workflow_completed', 'meeting_created'].includes(e.type));
    if (hasRelevant) fetchDeliverables();

    return () => {
      window.removeEventListener('ws:deliverable_created', handler);
      window.removeEventListener('ws:workflow_completed', handler);
      window.removeEventListener('ws:meeting_created', handler);
    };
  }, [fetchDeliverables]);

  const text = isDark ? 'text-gray-200' : 'text-gray-800';
  const sub = isDark ? 'text-gray-400' : 'text-gray-500';

  return (
    <div className="flex h-full flex-col rounded-lg border bg-white p-4 dark:border-gray-600 dark:bg-gray-800">
      <div
        className="mb-3 flex items-center justify-between cursor-pointer"
        onClick={onExpand}
      >
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Deliverables</span>
        {items.length > 0 && (
          <span className="text-xs text-blue-500 hover:underline">View all</span>
        )}
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-gray-400">Loading...</div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-gray-400">
          No deliverables yet
          <span className="mt-1 block text-[10px] text-gray-400">Meeting reports and workflow outputs appear here</span>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-auto">
          {items.map((d) => (
            <div
              key={d.id}
              className={`flex items-center gap-2 text-xs cursor-pointer ${d.filePath || d.meetingId ? 'hover:opacity-80' : ''}`}
              onClick={() => handleOpenDeliverable(d)}
            >
              <FileText size={12} className="flex-shrink-0 text-gray-400" />
              <span className={`truncate ${text}`}>{d.title}</span>
              <span className={`flex-shrink-0 ml-auto ${sub}`}>
                {new Date(d.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
