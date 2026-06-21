# Phase 4: Embedded Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed an interactive xterm.js terminal in Cabinet for CLI agents. PTY runs in Rust, output streams via Tauri events to React.

**Architecture:** Refactor polling `pty.rs` to event-push. New `useTerminal` hook manages lifecycle. New `TerminalPanel` component with xterm.js wraps into ChatView as a bottom split panel.

**Tech Stack:** Tauri 2, Rust + `portable-pty 0.8`, xterm.js 5.5+, xterm-addon-fit, React 19, TypeScript, Tailwind CSS v4.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/desktop/src-tauri/src/pty.rs` | Modify | Refactor polling to event-push via background thread |
| `apps/desktop/src-tauri/src/lib.rs` | Modify | Register new PTY commands |
| `apps/desktop/package.json` | Modify | Add xterm dependencies |
| `apps/desktop/src/hooks/useTerminal.ts` | Create | Tauri event subscription + PTY lifecycle |
| `apps/desktop/src/components/terminal/TerminalTab.tsx` | Create | Single xterm.js instance |
| `apps/desktop/src/components/terminal/TerminalPanel.tsx` | Create | Multi-tab + resizable panel |
| `apps/desktop/src/components/chat/AgentTopBar.tsx` | Modify | Add terminal toggle button |
| `apps/desktop/src/components/ChatView.tsx` | Modify | Embed TerminalPanel |
| `apps/desktop/src/App.tsx` | Modify | Pass terminal state to ChatView |

---

## Task 1: Refactor `pty.rs` to event-push

**Files:**
- Modify: `apps/desktop/src-tauri/src/pty.rs` (full rewrite)

- [ ] **Step 1: Rewrite `pty.rs` with event-push architecture**

Replace the entire file with:

```rust
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    agent_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PtyInfo {
    pub pty_id: String,
    pub agent_id: String,
    pub command: String,
    pub pid: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SpawnPtyArgs {
    pub agent_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub rows: Option<u16>,
    #[serde(default)]
    pub cols: Option<u16>,
}

#[tauri::command]
pub fn pty_spawn(app: AppHandle, state: State<'_, PtyManager>, args: SpawnPtyArgs) -> Result<String, String> {
    let pty_id = format!("pty_{}_{}", args.agent_id, std::process::id());
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: args.rows.unwrap_or(24),
            cols: args.cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(&args.command);
    cmd.args(&args.args);
    for (k, v) in &args.env {
        cmd.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.process_id();
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;

    let mut sessions = state.sessions.lock().unwrap();
    sessions.insert(
        pty_id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
            agent_id: args.agent_id.clone(),
        },
    );
    drop(sessions);

    // Background reader thread
    let app_clone = app.clone();
    let pty_id_clone = pty_id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty:data",
                        serde_json::json!({ "ptyId": pty_id_clone, "data": data }),
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(
            "pty:exit",
            serde_json::json!({ "ptyId": pty_id_clone, "exitCode": null }),
        );
    });

    Ok(pty_id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, pty_id: String, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&pty_id).ok_or("unknown pty_id")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyManager>, pty_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&pty_id).ok_or("unknown pty_id")?;
    session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, pty_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(mut session) = sessions.remove(&pty_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn pty_list(state: State<'_, PtyManager>) -> Result<Vec<PtyInfo>, String> {
    let sessions = state.sessions.lock().unwrap();
    let infos: Vec<PtyInfo> = sessions
        .iter()
        .map(|(id, s)| PtyInfo {
            pty_id: id.clone(),
            agent_id: s.agent_id.clone(),
            command: "unknown".to_string(),
            pid: s.child.process_id(),
        })
        .collect();
    Ok(infos)
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/desktop && npx tsc -b && cd src-tauri && cargo check 2>&1 | head -30`
Expected: PASS (may need cargo to install portable-pty; that's fine)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/pty.rs
git commit -m "feat(pty): refactor to event-push architecture with background reader threads"
```

---

## Task 2: Register new PTY commands in `lib.rs`

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Update invoke_handler with new commands**

Find the existing `pty` commands registration (around line 466). Replace with:

```rust
        pty::pty_spawn,
        pty::pty_write,
        pty::pty_resize,
        pty::pty_kill,
        pty::pty_list,
```

(Removes `pty_read` since we no longer need polling)

- [ ] **Step 2: Verify build**

Run: `cd apps/desktop && pnpm tauri:build 2>&1 | tail -20`
Expected: Rust compilation succeeds, `pty` binary built

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(pty): register new pty_list command, drop pty_read"
```

---

## Task 3: Add xterm.js dependencies

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Add xterm dependencies**

In `apps/desktop/package.json`, add to `dependencies`:

```json
"xterm": "^5.5.0",
"xterm-addon-fit": "^0.10.0"
```

- [ ] **Step 2: Install**

Run: `cd apps/desktop && pnpm install 2>&1 | tail -10`
Expected: xterm packages installed

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(terminal): add xterm.js and xterm-addon-fit dependencies"
```

---

## Task 4: Create `useTerminal` hook

**Files:**
- Create: `apps/desktop/src/hooks/useTerminal.ts`

- [ ] **Step 1: Create the hook**

Create `apps/desktop/src/hooks/useTerminal.ts`:

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface UseTerminalOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  onOutput?: (data: string) => void;
  onExit?: (code: number | null) => void;
  enabled: boolean;
}

export function useTerminal(opts: UseTerminalOptions) {
  const ptyIdRef = useRef<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [cols, setCols] = useState(80);
  const [rows, setRows] = useState(24);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Stable command key for effect dependency
  const commandKey = `${opts.command} ${opts.args.join(' ')}`;

  useEffect(() => {
    if (!opts.enabled) return;
    let unlistenData: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    (async () => {
      try {
        const ptyId = await invoke<string>('pty_spawn', {
          agentId: `terminal_${Date.now()}`,
          command: opts.command,
          args: opts.args,
          env: opts.env ?? {},
        });
        ptyIdRef.current = ptyId;
        setIsRunning(true);

        unlistenData = await listen<{ ptyId: string; data: string }>('pty:data', (event) => {
          if (event.payload.ptyId === ptyId) {
            optsRef.current.onOutput?.(event.payload.data);
          }
        });
        unlistenExit = await listen<{ ptyId: string; exitCode: number | null }>('pty:exit', (event) => {
          if (event.payload.ptyId === ptyId) {
            setIsRunning(false);
            optsRef.current.onExit?.(event.payload.exitCode);
          }
        });
      } catch (err) {
        console.error('Failed to spawn PTY:', err);
        setIsRunning(false);
      }
    })();

    return () => {
      unlistenData?.();
      unlistenExit?.();
      if (ptyIdRef.current) {
        invoke('pty_kill', { ptyId: ptyIdRef.current }).catch(() => {});
        ptyIdRef.current = null;
        setIsRunning(false);
      }
    };
  }, [commandKey, opts.enabled]);

  const write = useCallback(async (data: string) => {
    if (ptyIdRef.current) {
      try {
        await invoke('pty_write', { ptyId: ptyIdRef.current, data });
      } catch (err) {
        console.error('Failed to write to PTY:', err);
      }
    }
  }, []);

  const resize = useCallback(async (c: number, r: number) => {
    setCols(c);
    setRows(r);
    if (ptyIdRef.current) {
      try {
        await invoke('pty_resize', { ptyId: ptyIdRef.current, cols: c, rows: r });
      } catch (err) {
        console.error('Failed to resize PTY:', err);
      }
    }
  }, []);

  return { isRunning, cols, rows, write, resize };
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS (or fix any @tauri-apps imports)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/hooks/useTerminal.ts
git commit -m "feat(terminal): add useTerminal hook for PTY lifecycle management"
```

---

## Task 5: Create `TerminalTab` component

**Files:**
- Create: `apps/desktop/src/components/terminal/TerminalTab.tsx`

- [ ] **Step 1: Create the component**

Create `apps/desktop/src/components/terminal/TerminalTab.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useTerminal } from '../../hooks/useTerminal';

interface TerminalTabProps {
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  onClose: () => void;
}

export function TerminalTab({ id, label, command, args, env, onClose }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false);

  const termRef = useRef<{ write: (d: string) => Promise<void>; resize: (c: number, r: number) => Promise<void> } | null>(null);

  const { write, resize, isRunning } = useTerminal({
    command,
    args,
    env,
    enabled: ready,
    onOutput: (data) => xtermRef.current?.write(data),
  });

  termRef.current = { write, resize };

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      fontSize: 12,
      fontFamily: 'Menlo, Consolas, monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    term.onData((data) => termRef.current?.write(data));

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        termRef.current?.resize(term.cols, term.rows);
      } catch {
        // ignore
      }
    });
    ro.observe(containerRef.current);

    setReady(true);
    term.focus();

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-surface-muted flex shrink-0 items-center justify-between border-b px-3 py-1">
        <span className="text-content-secondary text-xs">
          {label} {isRunning ? <span className="text-intent-success">●</span> : <span className="text-content-tertiary">○</span>}
        </span>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-primary text-xs"
          aria-label="Close terminal"
        >
          ✕
        </button>
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
```

- [ ] **Step 2: Create barrel export**

Create `apps/desktop/src/components/terminal/index.ts`:

```typescript
export { TerminalTab } from './TerminalTab';
export { TerminalPanel } from './TerminalPanel';
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/terminal/TerminalTab.tsx apps/desktop/src/components/terminal/index.ts
git commit -m "feat(terminal): add TerminalTab component with xterm.js"
```

---

## Task 6: Create `TerminalPanel` component

**Files:**
- Create: `apps/desktop/src/components/terminal/TerminalPanel.tsx`

- [ ] **Step 1: Create the panel**

Create `apps/desktop/src/components/terminal/TerminalPanel.tsx`:

```typescript
import { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalTab } from './TerminalTab';

export interface TerminalTabConfig {
  id: string;
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface TerminalPanelProps {
  tabs: TerminalTabConfig[];
  activeTabId: string | null;
  onActiveTabChange: (id: string | null) => void;
  onTabClose: (id: string) => void;
  onAddTab: () => void;
  onClose: () => void;
}

export function TerminalPanel({
  tabs,
  activeTabId,
  onActiveTabChange,
  onTabClose,
  onAddTab,
  onClose,
}: TerminalPanelProps) {
  const [height, setHeight] = useState(240);
  const [isResizing, setIsResizing] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    startYRef.current = e.clientY;
    startHeightRef.current = height;
  }, [height]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => {
      const delta = startYRef.current - e.clientY;
      setHeight(Math.max(80, Math.min(600, startHeightRef.current + delta)));
    };
    const handleUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isResizing]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div
      style={{ height }}
      className="border-border bg-surface-elevated flex shrink-0 flex-col border-t"
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`h-1 cursor-row-resize transition-colors ${isResizing ? 'bg-accent' : 'hover:bg-accent-muted'}`}
      />

      {/* Tab bar */}
      <div className="bg-surface-muted flex shrink-0 items-center justify-between border-b px-2 py-0.5">
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onActiveTabChange(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-t px-2 py-1 text-xs transition-colors ${
                activeTabId === tab.id
                  ? 'bg-surface-elevated text-content-primary'
                  : 'text-content-tertiary hover:bg-surface-overlay'
              }`}
            >
              <span className="font-mono">$</span>
              {tab.label}
            </button>
          ))}
          <button
            onClick={onAddTab}
            className="text-content-tertiary hover:text-content-primary shrink-0 rounded px-1.5 py-0.5 text-xs"
            aria-label="New terminal"
            title="New terminal"
          >
            +
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content-primary shrink-0 px-1.5 py-0.5 text-xs"
          aria-label="Close terminal panel"
        >
          ✕
        </button>
      </div>

      {/* Active tab */}
      <div className="flex-1 overflow-hidden bg-[#1a1a1a]">
        {activeTab ? (
          <TerminalTab
            id={activeTab.id}
            label={activeTab.label}
            command={activeTab.command}
            args={activeTab.args}
            env={activeTab.env}
            onClose={() => onTabClose(activeTab.id)}
          />
        ) : (
          <div className="text-content-tertiary p-4 text-center text-xs">
            No terminal open. Click + to start a new terminal.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/components/terminal/TerminalPanel.tsx
git commit -m "feat(terminal): add TerminalPanel with multi-tab + resizable layout"
```

---

## Task 7: Import xterm CSS in entry

**Files:**
- Modify: `apps/desktop/src/index.tsx` (or whichever file is the entry point)

- [ ] **Step 1: Find the entry file**

Run: `cd apps/desktop && grep -l "createRoot" src/*.tsx src/**/*.tsx 2>/dev/null | head -3`
Expected: Find the entry file (likely `src/main.tsx` or `src/index.tsx`)

- [ ] **Step 2: Add xterm CSS import**

Add at the top of the entry file:

```typescript
import 'xterm/css/xterm.css';
import 'xterm-addon-fit/css/xterm-addon-fit.css';
```

(Add after other CSS imports, before any other code)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main.tsx
git commit -m "feat(terminal): import xterm CSS in entry point"
```

---

## Task 8: Add terminal toggle to `AgentTopBar`

**Files:**
- Modify: `apps/desktop/src/components/chat/AgentTopBar.tsx`

- [ ] **Step 1: Add new props**

Add to `AgentTopBarProps` interface:

```typescript
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  terminalEnabled: boolean;
```

- [ ] **Step 2: Add terminal button**

After the existing sidebar toggle button, add a new button:

```typescript
      <button
        aria-label="Toggle terminal"
        onClick={onToggleTerminal}
        disabled={!terminalEnabled}
        className={`flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-40 ${
          terminalOpen ? 'bg-[var(--surface-muted)]' : ''
        }`}
        title={terminalEnabled ? 'Terminal' : 'Terminal requires a CLI agent'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </button>
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/chat/AgentTopBar.tsx
git commit -m "feat(terminal): add terminal toggle button to AgentTopBar"
```

---

## Task 9: Add `TerminalPanel` to `ChatView`

**Files:**
- Modify: `apps/desktop/src/components/ChatView.tsx`

- [ ] **Step 1: Add imports**

Add to top of file:

```typescript
import { TerminalPanel, type TerminalTabConfig } from './terminal';
```

- [ ] **Step 2: Add new props**

Add to `Props` interface:

```typescript
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  activeExternalAgent: { command: string; args: string[]; env?: Record<string, string> } | null;
```

- [ ] **Step 3: Add terminal state in component**

Inside the `ChatView` function, add:

```typescript
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabConfig[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);

  // Auto-spawn terminal when toggle opens and we have a CLI agent
  useEffect(() => {
    if (terminalOpen && activeTerminalId === null && activeExternalAgent) {
      const id = `term_${Date.now()}`;
      setTerminalTabs([{
        id,
        label: 'Shell',
        command: activeExternalAgent.command,
        args: activeExternalAgent.args,
        env: activeExternalAgent.env,
      }]);
      setActiveTerminalId(id);
    }
    if (!terminalOpen) {
      setTerminalTabs([]);
      setActiveTerminalId(null);
    }
  }, [terminalOpen, activeExternalAgent]);
```

- [ ] **Step 4: Pass new props to AgentTopBar**

Update the `<AgentTopBar>` JSX:

```typescript
        <AgentTopBar
          agents={agents}
          activeAgentId={activeAgentId}
          onSelectAgent={onSelectAgent}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={onToggleSidebar}
          terminalOpen={terminalOpen}
          onToggleTerminal={onToggleTerminal}
          terminalEnabled={activeExternalAgent !== null}
        />
```

- [ ] **Step 5: Render `TerminalPanel` at bottom of main flex column**

Find the closing `</div>` of the inner content area (just before the closing of the outer `flex flex-col`). Insert before it:

```typescript
        {terminalOpen && (
          <TerminalPanel
            tabs={terminalTabs}
            activeTabId={activeTerminalId}
            onActiveTabChange={setActiveTerminalId}
            onTabClose={(id) => {
              setTerminalTabs(tabs => tabs.filter(t => t.id !== id));
              setActiveTerminalId(curr => (curr === id ? null : curr));
            }}
            onAddTab={() => {
              if (!activeExternalAgent) return;
              const id = `term_${Date.now()}`;
              setTerminalTabs(tabs => [...tabs, {
                id,
                label: `Shell ${tabs.length + 1}`,
                command: activeExternalAgent.command,
                args: activeExternalAgent.args,
                env: activeExternalAgent.env,
              }]);
              setActiveTerminalId(id);
            }}
            onClose={onToggleTerminal}
          />
        )}
```

- [ ] **Step 6: Run typecheck**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1 | head -20`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/ChatView.tsx
git commit -m "feat(terminal): embed TerminalPanel in ChatView with auto-spawn from active CLI agent"
```

---

## Task 10: Wire up `App.tsx` with terminal state and CLI agent resolution

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add state**

Inside the main component, add:

```typescript
  const [terminalOpen, setTerminalOpen] = useState(false);
```

- [ ] **Step 2: Resolve active external agent**

After the existing `useChat()` destructuring, add:

```typescript
  const activeExternalAgent = useMemo(() => {
    const agent = agents.find((a) => a.id === activeAgent);
    if (!agent || agent.source !== 'external_cli') return null;
    return { command: agent.id.replace('external_cli:', ''), args: [], env: undefined };
  }, [agents, activeAgent]);
```

(If `AgentInfo` doesn't yet have `external.command`, we can fall back to the agent's `name` or `id` for the command name)

- [ ] **Step 3: Pass props to ChatView**

Update the `<ChatView>` JSX to include:

```typescript
                        terminalOpen={terminalOpen}
                        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
                        activeExternalAgent={activeExternalAgent}
```

- [ ] **Step 4: Run typecheck and build**

Run: `cd apps/desktop && pnpm build 2>&1 | tail -20`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(terminal): wire App.tsx with terminal state and active agent resolution"
```

---

## Task 11: Final integration test

**Files:**
- None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `cd apps/desktop && npx tsc --noEmit 2>&1`
Expected: PASS

- [ ] **Step 2: Build the desktop app**

Run: `cd apps/desktop && pnpm build 2>&1 | tail -15`
Expected: Build succeeds

- [ ] **Step 3: Verify visually**

Run: `cd apps/desktop && pnpm dev`
Open browser to `http://localhost:5173`. Click the Secretary Orb. Switch to a CLI agent (e.g., external_cli:claude). Click the terminal icon in the top bar. Verify:
1. Terminal panel opens at the bottom
2. If Claude CLI is installed, it launches in interactive mode
3. Output streams to xterm.js
4. Resize handle works
5. Tab close (✕) works

- [ ] **Step 4: Final commit if needed**

```bash
git add -A
git commit -m "fix: terminal integration adjustments"
```

---

## Self-Review Notes

- **Spec coverage:** All design sections covered — Rust PTY refactor, xterm integration, panel UI, AgentTopBar integration, ChatView layout, App.tsx state.
- **Type consistency:** `TerminalTabConfig` defined in `TerminalPanel.tsx`, used in `TerminalPanel` and `ChatView` consistently.
- **No placeholders:** All code blocks contain complete implementations.
- **Migration path:** Tasks follow logical order: Rust backend → frontend hook → components → integration → wiring.
