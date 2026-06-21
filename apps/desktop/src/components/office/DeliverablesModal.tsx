import { ModalOverlay } from '../ModalOverlay';
import { useEffect } from 'react';
import { X, FileText } from 'lucide-react';
import { useDeliverables, type Deliverable } from '../../hooks/useDeliverables.js';

interface Props {
  onClose: () => void;
  projectId?: string;
}

export function DeliverablesModal({ onClose, projectId }: Props) {
  const { data: items = [], isLoading: loading } = useDeliverables(projectId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleOpen = (d: Deliverable) => {
    if (d.filePath) window.open(`/api/files/${d.filePath}`, '_blank');
  };

  return (
    <ModalOverlay
      isOpen={true}
      onClose={onClose}
      contentClassName="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg"
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-accent" />
          <h3 className="text-content-primary text-lg font-semibold">Deliverables</h3>
        </div>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-secondary flex h-6 w-6 items-center justify-center rounded-sm"
        >
          <X size={16} />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="border-accent h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-content-tertiary py-12 text-center text-sm">No deliverables</div>
      ) : (
        <div className="space-y-1.5 overflow-y-auto px-5 pb-4">
          {items.map((d) => (
            <div
              key={d.id}
              onClick={() => handleOpen(d)}
              className={`border-border bg-surface-muted flex items-center gap-3 rounded-sm border p-3 ${d.filePath ? 'hover:border-accent cursor-pointer' : ''}`}
            >
              <FileText size={16} className="text-content-tertiary shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-content-secondary truncate text-sm">{d.title}</div>
                <div className="text-content-tertiary flex items-center gap-2 text-[11px]">
                  <span className="capitalize">{d.type}</span>
                  <span>{d.projectId}</span>
                  <span className="ml-auto">{new Date(d.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              {d.tags.length > 0 && (
                <div className="hidden gap-1 sm:flex">
                  {d.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className="bg-surface-primary text-content-tertiary rounded-sm px-1.5 py-0.5 text-[10px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </ModalOverlay>
  );
}
