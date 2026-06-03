import { useEffect, useRef } from 'react';
import { X, Maximize2 } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  onClose: () => void;
  onExpand: () => void;
  title?: string;
}

export function OverlayChatPanel({ children, onClose, onExpand, title = 'Secretary' }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use setTimeout to avoid catching the click that opened the panel
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="fixed bottom-24 right-6 z-40 flex w-[480px] max-h-[70vh] min-h-[320px] flex-col rounded-2xl border border-border bg-surface-primary/95 dark:bg-surface-sidebar/95 backdrop-blur-md shadow-2xl overflow-hidden animate-[panel-rise_0.3s_ease-out]"
      style={{ transformOrigin: 'bottom right' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
        <span className="text-sm font-semibold text-content-primary">{title}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onExpand}
            className="flex h-7 w-7 items-center justify-center rounded-md text-content-tertiary transition-colors hover:bg-surface-muted hover:text-content-secondary"
            title="Expand to full chat"
            aria-label="Expand to full chat"
          >
            <Maximize2 size={14} />
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-content-tertiary transition-colors hover:bg-surface-muted hover:text-content-secondary"
            title="Close"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
