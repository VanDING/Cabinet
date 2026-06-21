# Phase 4: Embedded Terminal Design

**Date:** 2026-06-20
**Status:** Draft
**Supersedes:** N/A

## Overview

Embed an interactive terminal inside Cabinet for launching external CLI agents in their native TUI mode (e.g., Claude Code's interactive terminal, Codex CLI). Splits the chat view into chat + terminal panes with a toggleable bottom panel.

## Goals

1. **In-app terminal** — Run a real PTY in the Tauri backend, stream output to xterm.js in the React frontend
2. **Per-session terminal** — Each chat session can spawn one terminal bound to a CLI agent
3. **Toggle on/off** — A terminal button in `AgentTopBar` opens/closes a bottom split panel (VSCode-style)
4. **Cross-platform** — Use `portable-pty` (already in Cargo.toml) on Windows/macOS/Linux
5. **Streaming architecture** — Refactor existing `pty.rs` from polling to event-push

## Architecture

### Current state (gaps)

- `apps/desktop/src-tauri/src/pty.rs` — Polling-based (`try_read` returns 4KB chunks, frontend must call repeatedly). 5 Tauri commands: `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`, `pty_read`.
- `apps/desktop/src/types/xterm.d.ts` — Type stubs exist for xterm, but no actual `xterm` package in `package.json`.
- `ChatView.tsx` — Has clean flex column layout: AgentTopBar → SessionSidebar + content. Bottom panel slot is available.
- `Session` interface — Has `agentId?: string`. No terminal field yet.

### Target state

```
┌──────────────────────────────────────────────────────────────┐
│  AgentTopBar (avatar row + ☰ Sessions + 💻 Terminal toggle)  │
├────────────┬─────────────────────────────────────────────────┤
│ Session    │  Chat Messages                                   │
│ Sidebar    │  (current ChatView content)                      │
│            │                                                  │
│            │  ┌────────────────────────────────────────────┐  │
│            │  │ Terminal Panel (when toggled)             │  │
│            │  │ [Claude Code] [Codex] [+]                │  │
│            │  │ ▌ xterm.js output                         │  │
│            │  └────────────────────────────────────────────┘  │
│            ├─────────────────────────────────────────────────┤
│            │  ChatPanel (floating input)                      │
└────────────┴─────────────────────────────────────────────────┘
```

## Component Design

### 1. Rust: Refactor `pty.rs` to event-push

**File:** `apps/desktop/src-tauri/src/pty.rs`

**Change:** Spawn a background reader thread per session that pushes output via `app.emit("pty:data", { ptyId, data })`. Copy the pattern from `lib.rs:249-341` (`monitor_server` → `app.emit("server-status", ...)`).

```rust
// Pseudo-code
pub fn spawn_pty(app: AppHandle, manager: &PtyManager, agent_id: String, command: String, args: Vec<String>, env: HashMap<String, String>) -> String {
    let pty_id = format!("pty_{}_{}", agent_id, uuid::Uuid::new_v4().simple());
    let session = open_pty_pair(...);
    let child = spawn_child(...);

    // Background reader thread
    let app_clone = app.clone();
    let pty_id_clone = pty_id.clone();
    let reader = session.master.try_clone_reader()?;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit("pty:data", serde_json::json!({ "ptyId": pty_id_clone, "data": chunk }));
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit("pty:exit", serde_json::json!({ "ptyId": pty_id_clone }));
    });

    pty_id
}
```

**New Tauri commands:**
- `pty_spawn(agent_id, command, args, env) -> pty_id` — Spawns PTY + reader thread, returns ID
- `pty_write(pty_id, data)` — Forward keystrokes
- `pty_resize(pty_id, cols, rows)` — Handle xterm resize
- `pty_kill(pty_id)` — Kill process
- `pty_list() -> Vec<PtyInfo>` — List active sessions

**Events emitted:**
- `pty:data` — `{ ptyId, data }` per chunk
- `pty:exit` — `{ ptyId, exitCode? }` on process exit
- `pty:error` — `{ ptyId, error }` on spawn/runtime errors

### 2. Dependencies: xterm.js

**File:** `apps/desktop/package.json`

Add:
```json
"xterm": "^5.5.0",
"xterm-addon-fit": "^0.10.0"
```

**File:** `apps/desktop/src/index.tsx` (or main entry)

Add:
```typescript
import 'xterm/css/xterm.css';
import 'xterm-addon-fit/css/xterm-addon-fit.css';
```

### 3. Hook: `useTerminal`

**File:** `apps/desktop/src/hooks/useTerminal.ts`

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

interface UseTerminalOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  onOutput?: (data: string) => void;
  onExit?: (code: number | null) => void;
}

export function useTerminal(opts: UseTerminalOptions | null) {
  const ptyIdRef = useRef<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [cols, setCols] = useState(80);
  const [rows, setRows] = useState(24);

  // Spawn / kill lifecycle
  useEffect(() => {
    if (!opts) return;
    let unlistenData: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    (async () => {
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
          opts.onOutput?.(event.payload.data);
        }
      });
      unlistenExit = await listen<{ ptyId: string; exitCode: number | null }>('pty:exit', (event) => {
        if (event.payload.ptyId === ptyId) {
          setIsRunning(false);
          opts.onExit?.(event.payload.exitCode);
        }
      });
    })();

    return () => {
      unlistenData?.();
      unlistenExit?.();
      if (ptyIdRef.current) {
        invoke('pty_kill', { ptyId: ptyIdRef.current });
        ptyIdRef.current = null;
        setIsRunning(false);
      }
    };
  }, [opts?.command, JSON.stringify(opts?.args)]);

  const write = useCallback(async (data: string) => {
    if (ptyIdRef.current) {
      await invoke('pty_write', { ptyId: ptyIdRef.current, data });
    }
  }, []);

  const resize = useCallback(async (c: number, r: number) => {
    setCols(c);
    setRows(r);
    if (ptyIdRef.current) {
      await invoke('pty_resize', { ptyId: ptyIdRef.current, cols: c, rows: r });
    }
  }, []);

  return { isRunning, cols, rows, write, resize };
}
```

### 4. Component: `TerminalTab`

**File:** `apps/desktop/src/components/terminal/TerminalTab.tsx`

Wraps xterm.js. Manages terminal lifecycle, resize, input forwarding.

```typescript
import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useTerminal } from '../../hooks/useTerminal';

interface TerminalTabProps {
  label: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  onClose: () => void;
}

export function TerminalTab({ label, command, args, env, onClose }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false);

  const opts = { command, args, env, onOutput: (data: string) => xtermRef.current?.write(data) };
  const { write, resize, isRunning } = useTerminal(ready ? opts : null);

  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({ fontSize: 12, fontFamily: 'Menlo, Consolas, monospace' });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    term.onData((data) => write(data));

    const ro = new ResizeObserver(() => {
      fit.fit();
      resize(term.cols, term.rows);
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
          {label} {isRunning ? '●' : '○'}
        </span>
        <button onClick={onClose} className="text-content-tertiary hover:text-content-primary text-xs">
          ✕
        </button>
      </div>
      <div ref={containerRef} className="flex-1 bg-black p-2" />
    </div>
  );
}
```

### 5. Component: `TerminalPanel`

**File:** `apps/desktop/src/components/terminal/TerminalPanel.tsx`

Multi-tab container. Resizable height (drag handle at top). Empty state when no tabs.

```typescript
interface TerminalPanelProps {
  height: number;
  onHeightChange: (h: number) => void;
  onClose: () => void;
}

export function TerminalPanel({ height, onHeightChange, onClose }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  return (
    <div style={{ height }} className="border-border bg-surface-elevated flex flex-col border-t">
      <div className="bg-surface-muted flex shrink-0 items-center justify-between border-b px-2 py-0.5">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`rounded-t px-2 py-0.5 text-xs ${
                activeTab === t.id ? 'bg-surface-elevated text-content-primary' : 'text-content-tertiary'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button onClick={() => {/* open menu */}} className="text-content-tertiary px-2 text-xs">
            +
          </button>
        </div>
        <button onClick={onClose} className="text-content-tertiary hover:text-content-primary text-xs">
          ✕
        </button>
      </div>
      <div className="flex-1">
        {activeTab ? (
          <TerminalTab {...tabs.find((t) => t.id === activeTab)!} onClose={() => {/* close tab */}} />
        ) : (
          <div className="text-content-tertiary p-4 text-center text-sm">No terminal open. Press + to start.</div>
        )}
      </div>
    </div>
  );
}
```

### 6. Integration: `AgentTopBar` toggle

**File:** `apps/desktop/src/components/chat/AgentTopBar.tsx`

Add a Terminal icon button next to the existing session-list toggle. Pass `terminalOpen` and `onToggleTerminal` as new props.

### 7. Integration: `ChatView` layout

**File:** `apps/desktop/src/components/ChatView.tsx`

Add a `TerminalPanel` slot inside the main flex column, between messages scroll and close. State: `terminalOpen`, `terminalHeight`.

**New props:** `terminalOpen: boolean`, `onToggleTerminal: () => void`.

### 8. Integration: `App.tsx`

**File:** `apps/desktop/src/App.tsx`

Pass `terminalOpen` and `onToggleTerminal` to `<ChatView>`. The `activeAgent` (from `useChat()`) tells us which CLI agent's terminal to spawn.

### 9. Auto-spawn logic

When user clicks the terminal toggle and a CLI agent is active (`activeAgent.startsWith('external_cli:')`):
- Look up agent in `useAgents()`
- Get `external.command` and `external.args` from `ExternalAgentConfig`
- Spawn terminal with these args
- Inject `env` from Workbench bindings (Phase 3)

When no CLI agent is active, terminal button is disabled with tooltip "Terminal requires a CLI agent".

## State Management

**Terminal state lives in ChatView (local state)**, not in `ChatContext`:
- `terminalOpen: boolean`
- `terminalHeight: number` (default 240px)
- `terminalTabs: TerminalTab[]`
- `activeTab: string | null`

This is local because terminals are per-session ephemeral runtime artifacts, not durable data. PTYs are killed when the chat session ends or terminal panel closes.

**No changes to `Session` schema needed for first cut** — terminal metadata is intentionally not persisted. A future iteration could persist `terminalLayout: { lastHeight, lastCommand }` per session.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/desktop/src-tauri/src/pty.rs` | Modify | Refactor to event-push via background thread |
| `apps/desktop/src-tauri/src/lib.rs` | Modify | Update Tauri command signatures (add `pty_list`) |
| `apps/desktop/package.json` | Modify | Add `xterm` + `xterm-addon-fit` deps |
| `apps/desktop/src/index.css` (or entry) | Modify | Import xterm CSS |
| `apps/desktop/src/hooks/useTerminal.ts` | Create | Tauri event subscription + PTY lifecycle |
| `apps/desktop/src/components/terminal/TerminalTab.tsx` | Create | xterm.js wrapper |
| `apps/desktop/src/components/terminal/TerminalPanel.tsx` | Create | Multi-tab + resizable panel |
| `apps/desktop/src/components/terminal/index.ts` | Create | Barrel export |
| `apps/desktop/src/components/chat/AgentTopBar.tsx` | Modify | Add terminal toggle button |
| `apps/desktop/src/components/ChatView.tsx` | Modify | Embed TerminalPanel, pass props |
| `apps/desktop/src/App.tsx` | Modify | Pass terminalOpen + onToggleTerminal to ChatView |

## Implementation Phases (Within Phase 4)

1. **PTY refactor** — Rust event-push architecture
2. **xterm + useTerminal hook** — Frontend terminal lifecycle
3. **TerminalTab + TerminalPanel** — UI components
4. **ChatView integration** — Bottom split panel
5. **Auto-spawn from active CLI agent** — UX wiring

## Out of Scope (Future)

- Multi-tab persistence across app restart
- Terminal output logging / replay
- Agent-specific terminal profiles (different `args` for Claude vs Codex)
- Resize-to-fullscreen / minimize-to-icon
- Color theme sync with Cabinet themes

## Risks

1. **xterm.js bundle size** — ~200KB minified, separate chunk acceptable
2. **PTY env leakage** — Current `pty.rs:50-52` copies all env. For specific CLI agents, prefer `ExternalAgentConfig.env` (already configured via Workbench)
3. **macOS/Linux permissions** — Tauri on Unix already has PTY access; no extra capability needed
4. **Terminal escape sequences** — TUI apps like Claude Code use complex ANSI; xterm.js handles this
5. **Multiple PTY lifecycle** — Need to ensure killed PTYs are cleaned up on panel close / session end

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  React (Tauri WebView)                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ChatView                                              │  │
│  │  AgentTopBar [☰ Sessions] [💻 Terminal]             │  │
│  │  ┌────────────┬─────────────────────────────────────┐│  │
│  │  │ Session    │ Chat Messages                       ││  │
│  │  │ Sidebar    │   ...scrollable...                  ││  │
│  │  │            │ ┌─────────────────────────────────┐│  │
│  │  │            │ │ TerminalPanel (when open)       ││  │
│  │  │            │ │ [Claude Code] [Codex] [+]      ││  │
│  │  │            │ │   xterm.js                       ││  │
│  │  │            │ └─────────────────────────────────┘│  │
│  │  │            ├─────────────────────────────────────┤│  │
│  │  │            │ ChatPanel (input)                  ││  │
│  │  └────────────┴─────────────────────────────────────┘│  │
│  └──────────────────────────────────────────────────────┘  │
│       │  invoke('pty_spawn'/'pty_write'/'pty_resize'/'pty_kill')│
│       │  listen('pty:data'/'pty:exit'/'pty:error')             │
└───────│────────────────────────────────────────────│──────────┘
        ▼                                            ▲
┌─────────────────────────────────────────────────────────────┐
│  Rust (Tauri)                                                 │
│  PtyManager (state)                                          │
│    HashMap<ptyId, PtySession>                                │
│      master (portable-pty MasterPty)                         │
│      child (Child process)                                   │
│      reader_thread ──→ app.emit("pty:data", {ptyId, data})   │
│                       app.emit("pty:exit", {ptyId, code})    │
└─────────────────────────────────────────────────────────────┘
```
