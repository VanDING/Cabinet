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
      className="border-border bg-surface-2 absolute right-0 bottom-full z-50 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border shadow-xl"
    >
      <div className="border-border text-content-tertiary border-b px-3 py-2 text-xs uppercase">
        Recent Sessions
      </div>
      {history.length === 0 ? (
        <div className="text-content-tertiary px-4 py-6 text-center text-sm">
          No recent sessions
        </div>
      ) : (
        history.map((session) => (
          <div
            key={session.id}
            className="group hover:bg-surface-elevated bg-surface-input flex items-center justify-between px-3 py-2"
          >
            <button
              onClick={() => onReopen(session)}
              className="text-content-secondary flex-1 truncate text-left text-sm"
            >
              {session.title}
              <span className="text-content-tertiary block text-xs">
                {session.messages.length} msgs &middot;{' '}
                {new Date(session.createdAt).toLocaleDateString()}
              </span>
            </button>
            <button
              onClick={() => onDelete(session.id)}
              className="text-content-tertiary hover:text-intent-danger ml-2 p-1 opacity-0 transition-opacity group-hover:opacity-100"
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
