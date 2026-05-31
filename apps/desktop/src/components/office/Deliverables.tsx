import { useCallback } from 'react';
import { FileText } from 'lucide-react';
import { useDeliverables } from '../../hooks/useDeliverables';
import { useEvent } from '../../hooks/useEvent';

interface Props {
  projectId?: string;
  onExpand?: () => void;
}

export function Deliverables({ projectId, onExpand }: Props) {
  const { data: items = [], isLoading, refetch } = useDeliverables(projectId);

  useEvent('deliverable_created', () => refetch());
  useEvent('workflow_completed', () => refetch());
  useEvent('meeting_created', () => refetch());
  useEvent('task_completed', () => refetch());

  const handleOpenDeliverable = useCallback((d: (typeof items)[0]) => {
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
  }, []);

  const displayItems = items.slice(0, 5);
  const text = 'text-content-primary';
  const sub = 'text-content-tertiary';

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-surface-primary p-4 shadow-xs">
      <div className="mb-3 flex cursor-pointer items-center justify-between" onClick={onExpand}>
        <span className="text-sm font-medium text-content-secondary">Deliverables</span>
        {displayItems.length > 0 && (
          <span className="text-xs text-accent hover:underline">View all</span>
        )}
      </div>
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          Loading...
        </div>
      ) : displayItems.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-content-tertiary">
          No deliverables yet
          <span className="mt-1 block text-[10px] text-content-tertiary">
            Meeting reports and workflow outputs appear here
          </span>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-auto">
          {displayItems.map((d) => (
            <div
              key={d.id}
              className={`flex cursor-pointer items-center gap-2 text-xs ${d.filePath || d.meetingId ? 'hover:opacity-80' : ''}`}
              onClick={() => handleOpenDeliverable(d)}
            >
              <FileText size={12} className="shrink-0 text-content-tertiary" />
              <span className={`truncate ${text}`}>{d.title}</span>
              <span className={`ml-auto shrink-0 ${sub}`}>
                {new Date(d.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
