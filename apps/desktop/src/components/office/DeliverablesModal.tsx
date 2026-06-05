import { ModalOverlay } from '../ModalOverlay';
import { useEffect } from 'react';
import { X, FileText } from 'lucide-react';
import { useDeliverables, type Deliverable } from '../../hooks/useDeliverables.js';

interface Props { onClose: () => void; projectId?: string; }

export function DeliverablesModal({ onClose, projectId }: Props) {
  const { data: items = [], isLoading: loading } = useDeliverables(projectId);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleOpen = (d: Deliverable) => { if (d.filePath) window.open(`/api/files/${d.filePath}`, '_blank'); };

  return (
    <ModalOverlay isOpen={true} onClose={onClose} contentClassName="m-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-surface-primary shadow-lg">
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div className="flex items-center gap-2"><FileText size={16} className="text-accent" /><h3 className="text-lg font-semibold text-content-primary">Deliverables</h3></div>
        <button onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-sm text-content-tertiary hover:text-content-secondary"><X size={16} /></button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-12"><div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-content-tertiary">No deliverables</div>
      ) : (
        <div className="overflow-y-auto px-5 pb-4 space-y-1.5">
          {items.map((d) => (
            <div key={d.id} onClick={() => handleOpen(d)} className={`flex items-center gap-3 rounded-sm border border-border bg-surface-muted p-3 ${d.filePath ? 'cursor-pointer hover:border-accent' : ''}`}>
              <FileText size={16} className="shrink-0 text-content-tertiary" />
              <div className="min-w-0 flex-1"><div className="truncate text-sm text-content-secondary">{d.title}</div>
                <div className="flex items-center gap-2 text-[11px] text-content-tertiary"><span className="capitalize">{d.type}</span><span>{d.projectId}</span><span className="ml-auto">{new Date(d.createdAt).toLocaleDateString()}</span></div>
              </div>
              {d.tags.length > 0 && <div className="hidden sm:flex gap-1">{d.tags.slice(0, 2).map((t) => <span key={t} className="rounded-sm bg-surface-primary px-1.5 py-0.5 text-[10px] text-content-tertiary">{t}</span>)}</div>}
            </div>
          ))}
        </div>
      )}
    </ModalOverlay>
  );
}
