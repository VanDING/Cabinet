import { useRef, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import type { Session } from '../hooks/useSessions';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  history: Session[];
  onReopen: (session: Session) => void;
  onDelete: (id: string) => void;
}

export function SessionHistoryPanel({ isOpen, onClose, history, onReopen, onDelete }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full right-0 z-50 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-surface-primary shadow-xl"
    >
      <div className="border-b border-border px-3 py-2 text-xs uppercase text-content-tertiary">
        Recent Sessions
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-content-tertiary">No recent sessions</div>
      ) : (
        history.map((session) => (
          <div
            key={session.id}
            className="group flex items-center justify-between px-3 py-2 hover:bg-surface-elevated bg-surface-input"
          >
            <button
              onClick={() => onReopen(session)}
              className="flex-1 truncate text-left text-sm text-content-secondary"
            >
              {session.title}
              <span className="block text-xs text-content-tertiary">
                {session.messages.length} msgs &middot;{' '}
                {new Date(session.createdAt).toLocaleDateString()}
              </span>
            </button>
            <button
              onClick={() => onDelete(session.id)}
              className="ml-2 p-1 text-content-tertiary opacity-0 transition-opacity hover:text-intent-danger group-hover:opacity-100"
              aria-label="Delete session"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
