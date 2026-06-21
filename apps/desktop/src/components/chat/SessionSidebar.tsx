import { memo } from 'react';
import type { Session } from '../../hooks/useSessions.js';

interface SessionSidebarProps {
  sessions: Session[];
  activeAgentId: string;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
}

export const SessionSidebar = memo(function SessionSidebar({
  sessions,
  activeAgentId,
  activeSessionId,
  onSelectSession,
  onCreateSession,
}: SessionSidebarProps) {
  const agentSessions = sessions
    .filter((s) => !s.parentId && s.agentId === activeAgentId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return (
    <div className="flex w-[240px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--surface-primary)]">
      <div className="flex h-[40px] shrink-0 items-center justify-between border-b border-[var(--border-color)] px-3">
        <span className="text-content-secondary text-xs font-semibold">Sessions</span>
        <button
          aria-label="New session"
          onClick={onCreateSession}
          className="text-content-tertiary hover:text-content-primary flex h-[24px] w-[24px] items-center justify-center rounded transition-colors hover:bg-[var(--surface-muted)]"
          title="New session"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {agentSessions.length === 0 ? (
          <div className="text-content-tertiary px-3 py-4 text-center text-xs">
            No sessions yet. Click + to start.
          </div>
        ) : (
          agentSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'bg-accent-muted text-accent'
                    : 'text-content-secondary hover:bg-[var(--surface-muted)]'
                }`}
              >
                <span className="truncate text-xs font-medium">{session.title}</span>
                <span className="text-content-tertiary text-[10px]">
                  {session.messages.length} msgs · {session.updatedAt.toLocaleDateString()}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});
