import { useMemo } from 'react';

const GREETINGS = ['Good morning', 'Good afternoon', 'Good evening'];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return GREETINGS[0]!;
  if (h < 18) return GREETINGS[1]!;
  return GREETINGS[2]!;
}

export function WelcomeHeader() {
  const greeting = useMemo(() => getGreeting(), []);

  return (
    <div style={{ padding: '32px 32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* SecretaryOrb-style avatar */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: 'linear-gradient(135deg, var(--accent), var(--intent-purple))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(79,70,229,0.25)',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent-foreground)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="9" cy="10" r="1.5" fill="var(--accent-foreground)" />
            <circle cx="15" cy="10" r="1.5" fill="var(--accent-foreground)" />
            <path d="M8 16c0 0 1.5 2 4 2s4-2 4-2" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--content-primary)' }}>
            {greeting}, Captain
          </div>
          <div style={{ fontSize: 13, color: 'var(--content-secondary)', marginTop: 2 }}>
            Select a project or start a new task to begin working with your agents.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'default',
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
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'default',
            color: 'var(--content-secondary)',
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
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'default',
            color: 'var(--content-secondary)',
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
        </div>
      </div>
    </div>
  );
}
