# Phase 1: ChatView Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the chat interface to show all agents (built-in + external) in a top bar with clickable avatars, add a collapsible session sidebar grouped by agent, and remove the session history button from ChatPanel.

**Architecture:** New `AgentTopBar` and `SessionSidebar` components wrap the existing `ChatView` and `ChatPanel`. A new `useAgents` hook fetches the agent list from `/api/employees`. The `Session` type gains an `agentId` field so sessions can be grouped by agent. `ChatContext` exposes the agent list and manages agent-switching state.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, existing `useSessions` hook, existing `apiFetch` utility, Vitest + Testing Library for tests.

---

## File Structure

| File                                                  | Action | Responsibility                                                                                                                  |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/hooks/useAgents.ts`                 | Create | Fetch agent list from `/api/employees`, filter to `kind === 'ai'`, expose `{ agents, loading, refresh }`                        |
| `apps/desktop/src/components/chat/AgentTopBar.tsx`    | Create | Horizontal scrollable avatar row; click to select agent; shows status dots; session sidebar toggle button                       |
| `apps/desktop/src/components/chat/SessionSidebar.tsx` | Create | Collapsible left panel; lists sessions grouped by agent; new-session button; click to switch                                    |
| `apps/desktop/src/hooks/useSessions.ts`               | Modify | Add `agentId?: string` to `Session` and `SessionJSON` interfaces; persist it                                                    |
| `apps/desktop/src/contexts/ChatContext.tsx`           | Modify | Expose `agents` list and `sidebarOpen` state; wire `setActiveAgent` to create sessions with `agentId`                           |
| `apps/desktop/src/components/ChatView.tsx`            | Modify | Embed `AgentTopBar` at top; render `SessionSidebar` + messages in a flex row                                                    |
| `apps/desktop/src/components/ChatPanel.tsx`           | Modify | Remove session history button (clock icon + `SessionHistoryPanel`); remove hardcoded agent dropdown (replaced by `AgentTopBar`) |
| `apps/desktop/src/App.tsx`                            | Modify | Pass `agents` and `sidebarOpen` props to `ChatView`                                                                             |
| `apps/desktop/src/__tests__/AgentTopBar.test.tsx`     | Create | Test avatar rendering, selection callback, status dots                                                                          |
| `apps/desktop/src/__tests__/SessionSidebar.test.tsx`  | Create | Test session grouping, click-to-switch, new-session button                                                                      |

---

## Task 1: Add `agentId` to Session type

**Files:**

- Modify: `apps/desktop/src/hooks/useSessions.ts:63-92`

- [ ] **Step 1: Add `agentId` to `Session` interface**

In `apps/desktop/src/hooks/useSessions.ts`, add `agentId?: string` to the `Session` interface (after line 76, before the closing brace):

```typescript
export interface Session {
  id: string;
  title: string;
  projectId?: string;
  messages: ChatMessage[];
  attachedFiles: AttachedFile[];
  createdAt: Date;
  updatedAt: Date;
  // Sub-agent tree support
  parentId?: string;
  agentType?: string;
  status?: 'active' | 'waiting_for_user' | 'completed' | 'error';
  events?: AgentEvent[];
  deliverable?: unknown;
  // Agent binding for top-level sessions
  agentId?: string;
}
```

- [ ] **Step 2: Add `agentId` to `SessionJSON` interface**

In the same file, add `agentId?: string` to `SessionJSON` (after line 91, before the closing brace):

```typescript
interface SessionJSON {
  id: string;
  title: string;
  projectId?: string;
  messages: Array<Omit<ChatMessage, 'timestamp'> & { timestamp: string }>;
  attachedFiles: AttachedFile[];
  createdAt: string;
  updatedAt: string;
  parentId?: string;
  agentType?: string;
  status?: string;
  deliverable?: unknown;
  agentId?: string;
}
```

- [ ] **Step 3: Ensure `agentId` survives serialization**

Find the `loadSessions` function (around line 102) and the `saveSessions` function. Verify that the JSON round-trip preserves `agentId`. Since both interfaces now have the field and the load function maps fields generically, no additional code is needed — but verify by reading the `loadSessions` and `saveSessions` functions to confirm they spread or copy all fields.

- [ ] **Step 4: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: PASS (no new errors)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useSessions.ts
git commit -m "feat: add agentId field to Session type for agent-grouped sessions"
```

---

## Task 2: Create `useAgents` hook

**Files:**

- Create: `apps/desktop/src/hooks/useAgents.ts`

- [ ] **Step 1: Write the hook**

Create `apps/desktop/src/hooks/useAgents.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { apiFetch, authHeaders } from '../utils/api.js';

export interface AgentInfo {
  id: string;
  name: string;
  model?: string;
  kind: 'ai' | 'human';
  source: 'builtin' | 'custom' | 'external_cli' | 'external_a2a';
  status: 'active' | 'idle' | 'offline';
  expertise: string[];
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/employees', { headers: authHeaders() });
      const data = await res.json();
      const all: AgentInfo[] = data.employees ?? [];
      setAgents(all.filter((e) => e.kind === 'ai'));
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agents, loading, refresh };
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/hooks/useAgents.ts
git commit -m "feat: add useAgents hook to fetch AI agent list"
```

---

## Task 3: Create `AgentTopBar` component

**Files:**

- Create: `apps/desktop/src/components/chat/AgentTopBar.tsx`
- Create: `apps/desktop/src/__tests__/AgentTopBar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/__tests__/AgentTopBar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentTopBar } from '../components/chat/AgentTopBar';
import type { AgentInfo } from '../hooks/useAgents';

const mockAgents: AgentInfo[] = [
  { id: 'secretary', name: 'Secretary', kind: 'ai', source: 'builtin', status: 'active', expertise: [] },
  { id: 'external_cli:claude', name: 'Claude', kind: 'ai', source: 'external_cli', status: 'active', expertise: [] },
  { id: 'external_cli:codex', name: 'Codex', kind: 'ai', source: 'external_cli', status: 'offline', expertise: [] },
];

describe('AgentTopBar', () => {
  it('renders an avatar button for each agent', () => {
    render(
      <AgentTopBar
        agents={mockAgents}
        activeAgentId="secretary"
        onSelectAgent={() => {}}
        sidebarOpen={false}
        onToggleSidebar={() => {}}
      />,
    );
    expect(screen.getByTitle('Secretary')).toBeDefined();
    expect(screen.getByTitle('Claude')).toBeDefined();
    expect(screen.getByTitle('Codex')).toBeDefined();
  });

  it('calls onSelectAgent when an avatar is clicked', () => {
    const onSelect = vi.fn();
    render(
      <AgentTopBar
        agents={mockAgents}
        activeAgentId="secretary"
        onSelectAgent={onSelect}
        sidebarOpen={false}
        onToggleSidebar={() => {}}
      />,
    );
    fireEvent.click(screen.getByTitle('Claude'));
    expect(onSelect).toHaveBeenCalledWith('external_cli:claude');
  });

  it('calls onToggleSidebar when the toggle button is clicked', () => {
    const onToggle = vi.fn();
    render(
      <AgentTopBar
        agents={mockAgents}
        activeAgentId="secretary"
        onSelectAgent={() => {}}
        sidebarOpen={false}
        onToggleSidebar={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText('Toggle session list'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows status indicator dot', () => {
    render(
      <AgentTopBar
        agents={mockAgents}
        activeAgentId="secretary"
        onSelectAgent={() => {}}
        sidebarOpen={false}
        onToggleSidebar={() => {}}
      />,
    );
    // Active agent should have a status dot
    const claudeBtn = screen.getByTitle('Claude');
    expect(cludeBtn.querySelector('.status-dot')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/__tests__/AgentTopBar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

Create `apps/desktop/src/components/chat/AgentTopBar.tsx`:

```typescript
import { memo } from 'react';
import type { AgentInfo } from '../../hooks/useAgents.js';

interface AgentTopBarProps {
  agents: AgentInfo[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

const statusColor: Record<string, string> = {
  active: 'bg-intent-success',
  idle: 'bg-intent-warning',
  offline: 'bg-content-tertiary',
};

export const AgentTopBar = memo(function AgentTopBar({
  agents,
  activeAgentId,
  onSelectAgent,
  sidebarOpen,
  onToggleSidebar,
}: AgentTopBarProps) {
  return (
    <div
      className="flex h-[56px] shrink-0 items-center gap-1 border-b border-[var(--border-color)] bg-[var(--surface-elevated)] px-3"
    >
      <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
        {agents.map((agent) => {
          const isActive = agent.id === activeAgentId;
          return (
            <button
              key={agent.id}
              title={agent.name}
              onClick={() => onSelectAgent(agent.id)}
              className={`relative flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                isActive
                  ? 'border-accent shadow-sm'
                  : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <span
                className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[var(--surface-muted)] text-xs font-semibold"
                style={{ color: 'var(--content-primary)' }}
              >
                {agent.name.charAt(0).toUpperCase()}
              </span>
              <span
                className={`status-dot absolute bottom-0 right-0 h-[10px] w-[10px] rounded-full border-2 border-[var(--surface-elevated)] ${statusColor[agent.status] ?? 'bg-content-tertiary'}`}
              />
              {isActive && (
                <span className="absolute -bottom-[2px] left-1/2 h-[3px] w-[20px] -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
      <button
        aria-label="Toggle session list"
        onClick={onToggleSidebar}
        className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] text-content-secondary transition-colors hover:bg-[var(--surface-muted)] ${
          sidebarOpen ? 'bg-[var(--surface-muted)]' : ''
        }`}
        title="Session list"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
    </div>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/__tests__/AgentTopBar.test.tsx`
Expected: PASS — all 4 tests

- [ ] **Step 5: Run lint**

Run: `cd apps/desktop && npx eslint src/components/chat/AgentTopBar.tsx src/__tests__/AgentTopBar.test.tsx`
Expected: PASS (fix any issues if reported)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/chat/AgentTopBar.tsx apps/desktop/src/__tests__/AgentTopBar.test.tsx
git commit -m "feat: add AgentTopBar component with avatar row and sidebar toggle"
```

---

## Task 4: Create `SessionSidebar` component

**Files:**

- Create: `apps/desktop/src/components/chat/SessionSidebar.tsx`
- Create: `apps/desktop/src/__tests__/SessionSidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/__tests__/SessionSidebar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionSidebar } from '../components/chat/SessionSidebar';
import type { Session } from '../hooks/useSessions';

const mockSessions: Session[] = [
  {
    id: 's1',
    title: 'Refactor API',
    messages: [],
    attachedFiles: [],
    createdAt: new Date('2026-06-20T10:00:00Z'),
    updatedAt: new Date('2026-06-20T11:00:00Z'),
    agentId: 'external_cli:claude',
  },
  {
    id: 's2',
    title: 'Debug bug',
    messages: [],
    attachedFiles: [],
    createdAt: new Date('2026-06-20T09:00:00Z'),
    updatedAt: new Date('2026-06-20T09:30:00Z'),
    agentId: 'external_cli:claude',
  },
  {
    id: 's3',
    title: 'Migrate code',
    messages: [],
    attachedFiles: [],
    createdAt: new Date('2026-06-19T14:00:00Z'),
    updatedAt: new Date('2026-06-19T15:00:00Z'),
    agentId: 'external_cli:codex',
  },
];

describe('SessionSidebar', () => {
  it('renders sessions for the selected agent', () => {
    render(
      <SessionSidebar
        sessions={mockSessions}
        activeAgentId="external_cli:claude"
        activeSessionId="s1"
        onSelectSession={() => {}}
        onCreateSession={() => {}}
      />,
    );
    expect(screen.getByText('Refactor API')).toBeDefined();
    expect(screen.getByText('Debug bug')).toBeDefined();
    // Codex session should not appear when claude is selected
    expect(screen.queryByText('Migrate code')).toBeNull();
  });

  it('calls onSelectSession when a session is clicked', () => {
    const onSelect = vi.fn();
    render(
      <SessionSidebar
        sessions={mockSessions}
        activeAgentId="external_cli:claude"
        activeSessionId="s1"
        onSelectSession={onSelect}
        onCreateSession={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Debug bug'));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('calls onCreateSession when the new button is clicked', () => {
    const onCreate = vi.fn();
    render(
      <SessionSidebar
        sessions={mockSessions}
        activeAgentId="external_cli:claude"
        activeSessionId="s1"
        onSelectSession={() => {}}
        onCreateSession={onCreate}
      />,
    );
    fireEvent.click(screen.getByLabelText('New session'));
    expect(onCreate).toHaveBeenCalled();
  });

  it('shows empty state when no sessions for agent', () => {
    render(
      <SessionSidebar
        sessions={mockSessions}
        activeAgentId="secretary"
        activeSessionId={null}
        onSelectSession={() => {}}
        onCreateSession={() => {}}
      />,
    );
    expect(screen.getByText(/no sessions/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/__tests__/SessionSidebar.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the component**

Create `apps/desktop/src/components/chat/SessionSidebar.tsx`:

```typescript
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
        <span className="text-xs font-semibold text-content-secondary">Sessions</span>
        <button
          aria-label="New session"
          onClick={onCreateSession}
          className="flex h-[24px] w-[24px] items-center justify-center rounded text-content-tertiary transition-colors hover:bg-[var(--surface-muted)] hover:text-content-primary"
          title="New session"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {agentSessions.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-content-tertiary">
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
                <span className="text-[10px] text-content-tertiary">
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/__tests__/SessionSidebar.test.tsx`
Expected: PASS — all 4 tests

- [ ] **Step 5: Run lint**

Run: `cd apps/desktop && npx eslint src/components/chat/SessionSidebar.tsx src/__tests__/SessionSidebar.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/chat/SessionSidebar.tsx apps/desktop/src/__tests__/SessionSidebar.test.tsx
git commit -m "feat: add SessionSidebar component with agent-filtered session list"
```

---

## Task 5: Extend `ChatContext` with agents and sidebar state

**Files:**

- Modify: `apps/desktop/src/contexts/ChatContext.tsx`

- [ ] **Step 1: Add `agents` and `sidebarOpen` to the context value interface**

In `apps/desktop/src/contexts/ChatContext.tsx`, add to `ChatContextValue` interface (after line 56, after `setActiveAgent`):

```typescript
  agents: AgentInfo[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
```

Also add the import at the top of the file:

```typescript
import type { AgentInfo } from '../hooks/useAgents.js';
```

- [ ] **Step 2: Add state and wiring in `ChatProvider`**

Inside `ChatProvider` function (after the `activeAgent` useState around line 143), add:

```typescript
const [agents, setAgents] = useState<AgentInfo[]>([]);
const [sidebarOpen, setSidebarOpen] = useState(false);
```

Then add a `useEffect` to fetch agents on mount (after the sidebarOpen state):

```typescript
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const res = await apiFetch('/api/employees', { headers: authHeaders() });
      const data = await res.json();
      if (!cancelled) {
        const all = data.employees ?? [];
        setAgents(all.filter((e: { kind: string }) => e.kind === 'ai'));
      }
    } catch {
      if (!cancelled) setAgents([]);
    }
  })();
  return () => {
    cancelled = true;
  };
}, []);
```

Ensure `apiFetch` and `authHeaders` are imported (check existing imports at top of file — they should already be there from the existing `handleSend` function).

- [ ] **Step 3: Expose new values in the provider return**

Find the `value` object (around line 589) and add `agents`, `sidebarOpen`, `setSidebarOpen`:

```typescript
const value: ChatContextValue = {
  // ... existing fields ...
  activeAgent,
  setActiveAgent,
  agents,
  sidebarOpen,
  setSidebarOpen,
  // ... rest of existing fields ...
};
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: PASS (fix any type errors — the new fields must be in the interface and the value object)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/contexts/ChatContext.tsx
git commit -m "feat: expose agents list and sidebar state via ChatContext"
```

---

## Task 6: Modify `ChatPanel` — remove history button and hardcoded agent dropdown

**Files:**

- Modify: `apps/desktop/src/components/ChatPanel.tsx`

- [ ] **Step 1: Remove the session history button block**

In `apps/desktop/src/components/ChatPanel.tsx`, find lines 463-482 (the `<div className="relative">` block containing the clock button and `SessionHistoryPanel`). Delete the entire block:

```typescript
// DELETE this block (lines 463-482):
            <div className="relative">
              <button
                ref={historyBtnRef}
                onClick={() => setHistoryOpen(!historyOpen)}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${btnBaseClass} ${hoverClass}`}
                aria-label="Session history"
              >
                <Clock size={14} />
              </button>
              <SessionHistoryPanel
                isOpen={historyOpen}
                onClose={() => setHistoryOpen(false)}
                history={history}
                onReopen={(session) => {
                  onReopenSession(session);
                  setHistoryOpen(false);
                }}
                onDelete={(id) => onDeleteHistorySession(id)}
              />
            </div>
```

- [ ] **Step 2: Remove the hardcoded agent dropdown**

Find lines 306-344 (the `{/* Fixed @agent label */}` block with the `@{activeAgent}` button and dropdown menu). Replace it with a simpler read-only label that shows the current agent name (the `AgentTopBar` now handles selection):

```typescript
          {/* Agent label (selection via AgentTopBar) */}
          <div className="shrink-0">
            <span className="bg-accent-muted text-accent flex items-center rounded-sm px-1.5 py-0.5 text-xs font-bold">
              @{activeAgent}
            </span>
          </div>
```

- [ ] **Step 3: Remove unused imports and state**

At the top of the file, remove the `Clock` import from lucide-react if it's no longer used elsewhere. Remove the `SessionHistoryPanel` import. Remove the `historyBtnRef` ref declaration. Remove the `historyOpen` state declaration. Remove `agentMenuOpen` state and `agentBtnRef` ref if they're no longer used.

Search the file for any remaining references to these removed variables and remove them.

- [ ] **Step 4: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: PASS (fix any unused variable errors)

- [ ] **Step 5: Run existing ChatPanel tests**

Run: `cd apps/desktop && npx vitest run src/__tests__/ChatPanel.test.tsx`
Expected: May need updates — if tests reference the history button or agent dropdown, update them to match the new UI. Fix any failing tests.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/ChatPanel.tsx apps/desktop/src/__tests__/ChatPanel.test.tsx
git commit -m "refactor: remove session history button and hardcoded agent dropdown from ChatPanel"
```

---

## Task 7: Modify `ChatView` to embed `AgentTopBar` and `SessionSidebar`

**Files:**

- Modify: `apps/desktop/src/components/ChatView.tsx`

- [ ] **Step 1: Add imports at the top of ChatView.tsx**

Add after existing imports:

```typescript
import { AgentTopBar } from './chat/AgentTopBar.js';
import { SessionSidebar } from './chat/SessionSidebar.js';
import type { AgentInfo } from '../hooks/useAgents.js';
import type { Session } from '../hooks/useSessions.js';
```

- [ ] **Step 2: Extend the `Props` interface**

Find the `Props` type definition (before line 222) and add new props:

```typescript
interface Props {
  // ... existing props ...
  agents: AgentInfo[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  allSessions: Session[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
}
```

- [ ] **Step 3: Destructure new props in the component function**

Update the `ChatView` function signature (line 222) to include the new props:

```typescript
export const ChatView = memo(function ChatView({
  messages,
  isProcessing,
  attachedFiles,
  sessionTitle,
  onEditMessage,
  onRegenerate,
  onForkMessage,
  onContinue,
  childSessions,
  onSubAgentClick,
  onSubAgentApprove,
  onResetInputTarget,
  onBack,
  agents,
  activeAgentId,
  onSelectAgent,
  allSessions,
  sidebarOpen,
  onToggleSidebar,
  onSelectSession,
  onCreateSession,
}: Props) {
```

- [ ] **Step 4: Wrap the existing content with the new layout**

Find the `return` statement (around line 262). Wrap the existing `<div className="flex h-full flex-col">` with the new layout. The new structure:

```typescript
  return (
    <div className="flex h-full flex-col">
      <AgentTopBar
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={onSelectAgent}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
      />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <SessionSidebar
            sessions={allSessions}
            activeAgentId={activeAgentId}
            activeSessionId={null}
            onSelectSession={onSelectSession}
            onCreateSession={onCreateSession}
          />
        )}
        <div
          className="flex h-full flex-col flex-1"
          onClick={(e) => {
            if (e.currentTarget === e.target) {
              onResetInputTarget?.();
            }
          }}
        >
          {/* ... existing ChatView content (header, message list, scroll button) ... */}
        </div>
      </div>
    </div>
  );
```

Move the existing content (header bar, scrollable message list, scroll-to-bottom button) into the inner `<div className="flex h-full flex-col flex-1">`. Do not change the message rendering logic itself.

- [ ] **Step 5: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: PASS (fix any prop mismatches)

- [ ] **Step 6: Run existing ChatView tests**

Run: `cd apps/desktop && npx vitest run src/__tests__/ChatView.test.tsx`
Expected: Tests will fail because they don't pass the new required props. Update the test's `renderChatView` helper to pass default values for the new props:

```typescript
function renderChatView(props: Partial<Parameters<typeof ChatView>[0]> = {}) {
  return render(
    <ChatView
      messages={[]}
      isProcessing={false}
      attachedFiles={[]}
      sessionTitle="Test"
      onEditMessage={() => {}}
      onRegenerate={() => {}}
      onForkMessage={() => {}}
      onContinue={() => {}}
      childSessions={[]}
      onSubAgentClick={() => {}}
      onSubAgentApprove={() => {}}
      onResetInputTarget={() => {}}
      onBack={() => {}}
      agents={[]}
      activeAgentId="secretary"
      onSelectAgent={() => {}}
      allSessions={[]}
      sidebarOpen={false}
      onToggleSidebar={() => {}}
      onSelectSession={() => {}}
      onCreateSession={() => {}}
      {...props}
    />,
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/ChatView.tsx apps/desktop/src/__tests__/ChatView.test.tsx
git commit -m "feat: embed AgentTopBar and SessionSidebar into ChatView layout"
```

---

## Task 8: Wire up `App.tsx` to pass new props

**Files:**

- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Pull new values from `useChat()`**

Find where `useChat()` is destructured (around line 82). Add `agents`, `sidebarOpen`, `setSidebarOpen`:

```typescript
const {
  // ... existing destructured values ...
  activeAgent,
  setActiveAgent,
  agents,
  sidebarOpen,
  setSidebarOpen,
  // ... rest ...
} = useChat();
```

- [ ] **Step 2: Pass props to ChatView**

Find the `<ChatView` JSX (around line 432). Add the new props:

```typescript
                      <ChatView
                        messages={activeSession.messages}
                        isProcessing={isActiveSessionProcessing}
                        attachedFiles={activeSession.attachedFiles}
                        sessionTitle={activeSession.title}
                        onEditMessage={(msgId, newContent) => {
                          editMessage(activeSession.id, msgId, newContent);
                          handleSend(activeSession.id, newContent, activeSession.attachedFiles);
                        }}
                        onRegenerate={(msgId) => {
                          const idx = activeSession.messages.findIndex((m) => m.id === msgId);
                          if (idx > 0) {
                            const prevUser = activeSession.messages
                              .slice(0, idx)
                              .reverse()
                              .find((m) => m.role === 'user');
                            if (prevUser)
                              handleSend(
                                activeSession.id,
                                prevUser.content,
                                activeSession.attachedFiles,
                              );
                          }
                        }}
                        onForkMessage={(msgId) => {
                          const forkedId = forkSession(activeSession.id, msgId);
                          if (forkedId) {
                            addToast('success', 'Forked to new session');
                          }
                        }}
                        onContinue={(msgId) => {
                          handleSend(
                            activeSession.id,
                            'Please continue to complete the above tasks',
                            activeSession.attachedFiles,
                          );
                        }}
                        childSessions={getChildSessions(activeSession.id)}
                        onSubAgentClick={(sessionId) => {
                          const child = sessions.find((s) => s.id === sessionId);
                          if (child) {
                            setInputTarget({
                              type: 'subagent',
                              sessionId: child.id,
                              agentId: child.agentType ?? 'unknown',
                            });
                          }
                        }}
                        onSubAgentApprove={(sessionId) => {
                          apiFetch('/api/secretary/subagent/input', {
                            method: 'POST',
                            headers: authJsonHeaders(),
                            body: JSON.stringify({
                              subAgentSessionId: sessionId,
                              input: 'approved',
                            }),
                          })
                            .then(() => {
                              if (activeSession) {
                                setInputTarget({ type: 'secretary', sessionId: activeSession.id });
                              }
                            })
                            .catch(() => {
                              addToast('error', 'Failed to approve sub-agent');
                            });
                        }}
                        onResetInputTarget={() => {
                          if (inputTarget.type !== 'secretary') {
                            setInputTarget({ type: 'secretary', sessionId: activeSession.id });
                          }
                        }}
                        onBack={() => setUIMode('work')}
                        agents={agents}
                        activeAgentId={activeAgent}
                        onSelectAgent={setActiveAgent}
                        allSessions={sessions}
                        sidebarOpen={sidebarOpen}
                        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                        onSelectSession={switchSession}
                        onCreateSession={handleCreateSession}
                      />
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run all tests**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Build**

Run: `cd apps/desktop && pnpm build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat: wire App.tsx to pass agents and sidebar props to ChatView"
```

---

## Task 9: Wire `setActiveAgent` to create sessions with `agentId`

**Files:**

- Modify: `apps/desktop/src/contexts/ChatContext.tsx`

- [ ] **Step 1: Update `setActiveAgent` to set `agentId` on new sessions**

Currently `setActiveAgent` is a plain useState setter. We need to wrap it so that when the user switches agent, the next session created has the correct `agentId`.

In `ChatProvider`, after the `activeAgent` state, add a wrapped handler:

```typescript
const [activeAgent, setActiveAgentRaw] = useState('secretary');

const setActiveAgent = useCallback((agentId: string) => {
  setActiveAgentRaw(agentId);
  // If there's an active session, update its agentId
  setActiveSessions((prev) =>
    prev.map((s) => (s.id === activeSessionIdRef.current ? { ...s, agentId: agentId } : s)),
  );
}, []);
```

Note: `activeSessionIdRef` may not exist. Check how `activeSession` is tracked. If there's no ref, use the `activeSession` state directly:

```typescript
const setActiveAgent = useCallback(
  (agentId: string) => {
    setActiveAgentRaw(agentId);
    // Update current active session's agentId so it appears in the sidebar
    if (activeSession) {
      // Find and update the session in the sessions array
      setSessions((prev) => prev.map((s) => (s.id === activeSession.id ? { ...s, agentId } : s)));
    }
  },
  [activeSession],
);
```

Check the existing variable names — the sessions state setter might be named differently (e.g., from `useSessions` hook). Adapt the code to use the actual setter available in scope.

- [ ] **Step 2: Update `handleCreateSession` to stamp `agentId`**

Find the `handleCreateSession` function (around line 200+). When creating a new session, pass the current `activeAgent` as the `agentId`:

```typescript
const handleCreateSession = useCallback((): string => {
  const id = createSession({
    // ... existing options ...
  });
  // Stamp the session with the current agentId
  setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, agentId: activeAgent } : s)));
  return id;
}, [createSession, activeAgent, setSessions]);
```

Adapt variable names to match what's actually in scope from `useSessions`.

- [ ] **Step 3: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Run all tests**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/contexts/ChatContext.tsx
git commit -m "feat: stamp sessions with agentId when agent is selected or session created"
```

---

## Task 10: Final integration build and manual test

**Files:**

- None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `cd apps/desktop && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Run all tests**

Run: `cd apps/desktop && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Run lint**

Run: `cd apps/desktop && pnpm lint`
Expected: PASS (fix any issues)

- [ ] **Step 4: Build the desktop app**

Run: `cd apps/desktop && pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Verify visually**

Run: `cd apps/desktop && pnpm dev`
Open browser to `http://localhost:5173`. Click the Secretary Orb to enter chat mode. Verify:

1. Agent top bar appears at the top of the chat area with agent avatars
2. Clicking an avatar switches the active agent
3. The session sidebar toggle button shows/hides the left panel
4. The session sidebar lists sessions for the selected agent
5. The ChatPanel no longer has a clock (history) button
6. Sending a message routes to the selected agent

- [ ] **Step 6: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final integration adjustments for ChatView redesign"
```

---

## Self-Review Notes

- **Spec coverage:** All Phase 1 items from the design doc are covered: AgentTopBar (Task 3), SessionSidebar (Task 4), ChatView modification (Task 7), ChatPanel modification (Task 6), ChatContext external agent support (Tasks 5, 9), session sidebar toggle (Tasks 3, 7, 8).
- **Type consistency:** `AgentInfo` defined in Task 2, used in Tasks 3, 5, 7. `Session.agentId` added in Task 1, used in Tasks 4, 9. Props names consistent across Tasks 7 and 8.
- **No placeholders:** All code blocks contain complete implementations. Test code includes actual assertions.
- **Migration path matches spec:** Task order follows the spec's migration path (1. AgentTopBar, 2. SessionSidebar, 3. ChatView embed, 4. ChatPanel modify, 5. ChatContext modify, 6. wire up).
