import { useMemo, useCallback } from 'react';
import { useChat } from '../../contexts/ChatContext.js';
import { useProject } from '../../contexts/ProjectContext.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_TAG: Record<number, string> = {
  0: 'Rest and recharge',
  1: 'Fresh week ahead',
  2: 'Building momentum',
  3: 'Midweek push',
  4: 'Almost there',
  5: 'Finish strong',
  6: 'Weekend mode',
};

const ALT_GREETINGS = [
  'Back in action, Captain',
  'Ready when you are, Captain',
  'Your Cabinet is standing by',
  "What's the plan, Captain?",
  "Let's make something happen",
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Late night, Captain';
  if (h < 8) return 'Early start, Captain';
  if (h < 10) return 'Good morning, Captain';
  if (h < 12) return 'Almost noon, Captain';
  if (h < 14) return 'Good afternoon, Captain';
  if (h < 17) return 'Afternoon hustle, Captain';
  if (h < 19) return 'Good evening, Captain';
  if (h < 21) return 'Evening session, Captain';
  return 'Night owl, Captain';
}

function maybeAltGreeting(): string {
  if (Math.random() < 0.15) {
    return ALT_GREETINGS[Math.floor(Math.random() * ALT_GREETINGS.length)]!;
  }
  return '';
}

function getDayTag(): string {
  return DAY_TAG[new Date().getDay()] ?? '';
}

function getTagline(hasProjects: boolean, sessionCount: number, agentCount: number): string {
  if (!hasProjects) return 'Create your first project to get started.';
  if (agentCount > 0 && sessionCount === 0)
    return `${agentCount} agent(s) ready — Claude Code, Codex, and more.`;
  if (sessionCount > 0) return `${sessionCount} session(s) available — pick up where you left off.`;
  return 'Your Cabinet is ready. What would you like to do?';
}

export function WelcomeHeader() {
  const greeting = useMemo(() => getGreeting(), []);
  const altGreeting = useMemo(() => maybeAltGreeting(), []);
  const displayGreeting = altGreeting || greeting;
  const dayTag = useMemo(() => getDayTag(), []);
  const { history, agents, handleCreateSession, setUIMode } = useChat();
  const { projects, handleOpenProjectActionModal } = useProject();

  const sessionCount = history.length;
  const agentCount = agents.filter((a) => a.source === 'external_cli').length;
  const hasProjects = projects.length > 0;
  const tagline = useMemo(
    () => getTagline(hasProjects, sessionCount, agentCount),
    [hasProjects, sessionCount, agentCount],
  );

  const handleQuickTask = useCallback(() => {
    handleCreateSession();
    setUIMode('chat');
  }, [handleCreateSession, setUIMode]);

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dayName = DAYS[now.getDay()]!;

  return (
    <div style={{ padding: '64px 32px 48px' }}>
      <div className="flex items-center justify-between">
        <div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: 'var(--content-primary)',
              lineHeight: 1.2,
            }}
          >
            {displayGreeting}
          </div>
          <div style={{ fontSize: 14, color: 'var(--content-tertiary)', marginTop: 6 }}>
            {timeStr} · {dayName} · {dayTag}
          </div>
        </div>
      </div>
      <div
        style={{ fontSize: 16, color: 'var(--content-secondary)', marginTop: 12, maxWidth: 480 }}
      >
        {tagline}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
        <button
          onClick={handleOpenProjectActionModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 24px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--accent-foreground)',
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
            padding: '10px 24px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            color: 'var(--content-secondary)',
            border: '1px solid var(--border-color)',
            background: 'transparent',
          }}
        >
          Quick Task
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
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>
    </div>
  );
}
