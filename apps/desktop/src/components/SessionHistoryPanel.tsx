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
      className="absolute bottom-full right-0 z-50 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
    >
      <div className="border-b px-3 py-2 text-xs uppercase text-gray-400 dark:border-gray-700">
        Recent Sessions
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">No recent sessions</div>
      ) : (
        history.map((session) => (
          <div
            key={session.id}
            className="group flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <button
              onClick={() => onReopen(session)}
              className="flex-1 truncate text-left text-sm text-gray-700 dark:text-gray-200"
            >
              {session.title}
              <span className="block text-xs text-gray-400">
                {session.messages.length} msgs &middot;{' '}
                {new Date(session.createdAt).toLocaleDateString()}
              </span>
            </button>
            <button
              onClick={() => onDelete(session.id)}
              className="ml-2 p-1 text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
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
