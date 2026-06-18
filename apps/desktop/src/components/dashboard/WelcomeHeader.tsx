import { useMemo, useCallback } from 'react';
import { useChat } from '../../contexts/ChatContext.js';
import { useProject } from '../../contexts/ProjectContext.js';
import { useLayout } from '../../contexts/LayoutContext.js';

const GREETINGS = ['Good morning', 'Good afternoon', 'Good evening'];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return GREETINGS[0]!;
  if (h < 18) return GREETINGS[1]!;
  return GREETINGS[2]!;
}

export function WelcomeHeader() {
  const greeting = useMemo(() => getGreeting(), []);
  const { handleOpenProjectActionModal } = useProject();
  const { handleCreateSession, setUIMode } = useChat();

  const handleQuickTask = useCallback(() => {
    handleCreateSession();
    setUIMode('chat');
  }, [handleCreateSession, setUIMode]);

  return (
    <div style={{ padding: '48px 32px 36px' }}>
      <div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--content-primary)' }}>
          {greeting}, Captain
        </div>
        <div style={{ fontSize: 15, color: 'var(--content-secondary)', marginTop: 3 }}>
          Select a project or start a new task to begin working with your agents.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button
          onClick={handleOpenProjectActionModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 20px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            border: '1px solid var(--border-color)',
            background: 'var(--surface-elevated)',
            color: 'var(--content-primary)',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Project
        </button>
        <button
          onClick={handleQuickTask}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 20px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            color: 'var(--content-secondary)',
            border: 'none',
            background: 'transparent',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          Quick Task
        </button>
        <button
          onClick={handleOpenProjectActionModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 20px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            color: 'var(--content-secondary)',
            border: 'none',
            background: 'transparent',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Open Recent
        </button>
      </div>
    </div>
  );
}
