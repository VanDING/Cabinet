import { useRef, useEffect } from 'react';
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
    <div ref={panelRef} className="absolute bottom-full right-0 mb-1 w-72 max-h-64 overflow-y-auto bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg shadow-xl z-50">
      <div className="px-3 py-2 text-xs text-gray-400 uppercase border-b dark:border-gray-700">
        Recent Sessions
      </div>
      {history.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          No recent sessions
        </div>
      ) : (
        history.map(session => (
          <div
            key={session.id}
            className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 group"
          >
            <button
              onClick={() => onReopen(session)}
              className="flex-1 text-left text-sm text-gray-700 dark:text-gray-200 truncate"
            >
              {session.title}
              <span className="block text-xs text-gray-400">
                {session.messages.length} msgs &middot; {new Date(session.createdAt).toLocaleDateString()}
              </span>
            </button>
            <button
              onClick={() => onDelete(session.id)}
              className="ml-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label="Delete session"
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M3 4h8M5.5 4V3a1 1 0 011-1h1a1 1 0 011 1v1M6 7v4M8 7v4M4 4l.7 7.5a1 1 0 001 .5h2.6a1 1 0 001-.5L10 4" stroke="currentColor" fill="none" strokeWidth="1.2" />
              </svg>
            </button>
          </div>
        ))
      )}
    </div>
  );
}
