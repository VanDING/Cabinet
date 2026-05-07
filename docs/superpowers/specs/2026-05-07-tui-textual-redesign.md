# TUI Textual Redesign — Complete Architecture Spec

**Date**: 2026-05-07
**Status**: Approved
**Scope**: Full TUI rewrite — Rich + prompt_toolkit → Textual framework

## 1. Motivation

### Why the current Rich+prompt_toolkit architecture failed

After 3 rounds of bug fixes attempting to resolve input visibility, screen flicker, and command switching, the root cause remains unfixable within the current stack:

| Attempt | Fix | Result |
|---------|-----|--------|
| Round 1 | `live.stop()/start()` around input | Layout destroyed before display |
| Round 2 | Removed `live.stop()/start()`, kept `screen=True` | Input invisible (auto-refresh overwrites) |
| Round 3 | `auto_refresh=False` + `refresh=True` | Still broken — Rich Live and prompt_toolkit cannot reliably share the terminal |

**Fundamental issue**: Rich `Live` and prompt_toolkit `prompt_async()` are two independent renderers competing for terminal control. They have no coordination mechanism. Claude Code solved this by building its own renderer (Ink) that owns the entire terminal surface.

**Solution**: Migrate to **Textual** — a unified framework where a single rendering pipeline handles both display AND input. Textual is the de facto Python TUI framework from Will McGugan (author of Rich), and is the Python equivalent of Claude Code's React+Ink architecture.

## 2. Architecture Overview

### Claude Code → Cabinet Mapping

| Claude Code | Cabinet (New) |
|-------------|---------------|
| React + Ink | Textual Widget tree |
| Yoga Flexbox | Textual CSS/TCSS |
| AppStateStore (Zustand) | `reactive()` attributes |
| Patch rendering (diff) | Textual built-in diff renderer |
| Async generator query() | Textual `Worker` + async streaming |
| `useInput()` hook | Textual `Input` widget |
| `useAppState(selector)` | `watch_*` methods on reactive |
| Main screen buffer | Textual default inline mode |
| ~140 components | ~10 widgets (Cabinet's needs are simpler) |

### Key design principles

1. **Single rendering pipeline** — Textual owns all terminal output. No more Rich vs prompt_toolkit fights.
2. **Reactive state** — UI updates automatically when state changes. No manual `live.update()`.
3. **Component separation** — One widget per concern, each <200 lines.
4. **CSS styling** — Colors, layout, borders in `.tcss` files. Hot-reload during development.
5. **Main buffer** — Stay in the normal terminal buffer (no alt-screen). Preserve native scroll and text selection.

## 3. Dependency Change

**Add**: `textual>=0.86`

**Remove (optional)**: `prompt-toolkit` — no longer needed. Textual provides `Input` widget with completion support. Keep `prompt-toolkit` for one transitional release if needed.

**Keep**: `rich` — Textual uses Rich internally for Markdown rendering and console output. `typer` — CLI entry point unchanged.

## 4. Widget Tree

```
CabinetApp (App)
├── WelcomeScreen (Screen)              # welcome.py
│   └── logo + "press any key"
│
└── CockpitScreen (Screen)              # cockpit.py
    ├── Header (Static, h=1)            # widgets/header.py
    │   └── Token: X │ Session: 0:05 │ 🧭 决策室
    │
    ├── MainArea (Horizontal)           # CSS: #left 80%, #right 20%
    │   │
    │   ├── ContentPanel (Vertical, 80%)
    │   │   ├── SecretaryBar (Static, h=2)       # widgets/header.py
    │   │   ├── ConversationView (VerticalScroll) # widgets/conversation.py
    │   │   │   ├── UserMessage   "💬 {text}"    # dim, right-aligned
    │   │   │   └── AssistantMessage (Markdown)  # AI response
    │   │   └── ThinkingPanel (Collapsible)      # widgets/thinking.py
    │   │
    │   └── SidePanel (Vertical, 20%)            # widgets/side_panels.py
    │       ├── MeetingPanel (Panel)
    │       ├── DecisionPanel (Panel)
    │       └── OfficePanel (Panel)
    │
    └── InputArea (Static, h=3)                  # widgets/input_area.py
        ├── CompletionList (overlay)
        └── Input (prompt: "decision > ")
```

## 5. State Management

All UI state lives in `src/cabinet/cli/state.py` as a dataclass with `textual.reactive`:

```python
from textual.reactive import reactive
from dataclasses import dataclass, field
from datetime import datetime, timezone

@dataclass
class CockpitState:
    """Reactive cockpit state. Changes auto-trigger widget updates."""

    mode: str = "decision"
    token_count: int = 0
    session_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    secretary_message: str = ""
    secretary_urgent: bool = False
    captain_id: str = ""

    # Conversation
    conversation: list[dict] = field(default_factory=list)
    streaming_content: str = ""  # partial AI response during streaming

    # Thinking chain
    thinking_steps: list[str] = field(default_factory=list)
    thinking_expanded: bool = False

    # Right panel data
    meeting_topic: str = ""
    meeting_advisors: int = 0
    meeting_round: int = 0
    decision_red: int = 0
    decision_yellow: int = 0
    decision_blue: int = 0
    office_workflow: str = ""
    office_progress: float = 0.0
    office_current_node: str = ""
```

The `CockpitScreen` screen owns the state instance. Widgets access it via `self.app.query_one("#cockpit").state`.

### Watch methods (reactive callbacks)

```python
class CockpitScreen(Screen):
    state: CockpitState

    def watch_state_mode(self, old, new):
        """Mode changed → update header label and input prompt."""
        pass

    def watch_state_conversation(self, old, new):
        """Conversation grew → scroll to bottom, refresh ConversationView."""
        pass

    def watch_state_thinking_expanded(self, old, new):
        """Toggle thinking panel visibility."""
        pass
```

## 6. CSS Styling (cockpit.tcss)

```css
Screen {
    background: #0c0c0c;
}

Header Static {
    height: 1;
    background: #1a1a2e;
    color: #3B82F6;
    text-style: bold;
}

SecretaryBar Static {
    height: 2;
    color: #E2E8F0;
}
SecretaryBar.urgent {
    color: #CB220C;
    text-style: bold;
}

#left-panel {
    width: 80%;
}
#right-panel {
    width: 20%;
}

UserMessage {
    color: #64748B;
    text-align: right;
    padding: 0 2;
}

AssistantMessage Markdown {
    color: #E2E8F0;
    padding: 0 2;
}

ThinkingPanel {
    border: solid #EDB61B;
    height: auto;
    max-height: 10;
}

MeetingPanel, DecisionPanel, OfficePanel {
    border: solid #3B82F6;
    height: 1fr;
}

InputArea Input {
    border: solid #3B82F6;
    color: #ffffff;
}

InputArea Input:focus {
    border: solid #3B82F6;
}
```

## 7. Input System

Textual `Input` widget replaces prompt_toolkit entirely.

| Feature | Implementation |
|---------|---------------|
| Command prompt | `Input(placeholder="decision > ")` set via `value` |
| Tab completion | `Input` + `CompletionList` widget; filter on `/` prefix |
| Command history | `HistoryStore` backed by `data/.chat_history` file |
| Auto-suggest | `Input.suggester` — shows ghost text from history |
| Ctrl+T | `BINDINGS = [("ctrl+t", "toggle_thinking", "Toggle thinking")]` |
| Ctrl+C quit | `BINDINGS = [("ctrl+c", "quit", "Quit")]` |

### Mode-aware prompt

```python
def on_input_changed(self, event: Input.Changed):
    """Update prompt label when mode changes."""
    if event.value.startswith("/"):
        self.query_one("#completion-list").display = True
    else:
        self.query_one("#completion-list").display = False
```

## 8. Event System

Room state updates via Textual message passing, not polling.

### Streaming chat worker

```python
@work(exclusive=True)
async def stream_chat_response(self, user_input: str) -> None:
    """Async worker for streaming AI responses."""
    response = await self.runtime.secretary.process_input_stream(...)
    async for chunk in response.stream:
        self.state.streaming_content += chunk
        self.call_from_thread(self.refresh_conversation)
```

### Room event subscription

```python
# Instead of _sync_room_state polling:
async def on_decision_created(self, decision_id: UUID):
    self.state.decision_red += 1  # reactive auto-updates DecisionPanel

async def on_meeting_started(self, session_id: UUID, topic: str):
    self.state.meeting_topic = topic
    self.state.meeting_advisors += 1
```

## 9. File Structure

```
src/cabinet/cli/
├── main.py              (unchanged: Typer entry, _chat_async)
├── config.py            (unchanged)
├── providers.py         (unchanged)
├── commands/            (unchanged: 11 command modules)
│
├── app.py               NEW: CabinetApp(Textual App)
├── screens/
│   ├── welcome.py       NEW: WelcomeScreen (logo + keypress)
│   └── cockpit.py       NEW: CockpitScreen (main, ~150 lines)
├── widgets/
│   ├── header.py        NEW: Header + SecretaryBar (~60 lines)
│   ├── conversation.py  NEW: ConversationView + Messages (~100 lines)
│   ├── thinking.py      NEW: ThinkingPanel (~50 lines)
│   ├── side_panels.py   NEW: Meeting/Decision/Office panels (~80 lines)
│   └── input_area.py    NEW: InputArea + Completion (~80 lines)
├── state.py             NEW: CockpitState dataclass (~60 lines)
├── intent.py            MOVED: intent detection from tui.py (~50 lines)
├── commands.py          MOVED: slash command handling from tui.py (~60 lines)
│
├── cockpit.tcss         NEW: CSS styles (~80 lines)
│
└── tui.py               REMOVED (522 lines → split across above)
    tui_components.py    DEPRECATED (render functions → widget methods)
    tui_themes.py        SIMPLIFIED (colors → CSS variables)
```

**Summary**: 1 file removed (tui.py), 8 files created, 2 files simplified. Total new code ~700 lines (replacing ~500 lines of complex Rich/Live management).

## 10. Implementation Phases

### Phase 1: Foundation (Week 1)
- Add `textual` dependency to pyproject.toml
- Create `app.py` with `CabinetApp`
- Create `state.py` with `CockpitState`
- Create `cockpit.tcss` with color scheme and basic layout
- Create `WelcomeScreen` with logo
- Wire `cabinet chat` entry point to launch Textual app
- **Deliverable**: `cabinet chat` shows welcome screen → cockpit skeleton with header, sidebar, input

### Phase 2: Conversation + Input (Week 2)
- Create `ConversationView` widget
- Create `InputArea` with completion and history
- Wire streaming chat worker
- Implement intent detection integration
- **Deliverable**: Full chat experience with streaming, completion, conversation history

### Phase 3: Panels + Polish (Week 3)
- Create side panel widgets with live data
- Create ThinkingPanel (collapsible)
- Wire room state sync via events
- Slash command integration
- **Deliverable**: Complete cockpit with all panels functional

### Phase 4: Cleanup + Transition (Week 3-4)
- Remove `tui.py`, `tui_components.py` old code
- Simplify `tui_themes.py` (colors now in CSS)
- Update tests
- Remove `prompt-toolkit` dependency (optional)
- **Deliverable**: Clean codebase, old code removed

## 11. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Textual learning curve | Phased rollout — Phase 1 is display-only |
| prompt_toolkit features lost | Textual `Input` + `CompletionList` covers 90%; custom widget for edge cases |
| Performance with long conversations | Textual `VerticalScroll` with virtual scrolling |
| Breaking existing CLI commands | Only `cabinet chat` changes; all other commands unchanged |

## 12. Out of Scope (Future Architecture Optimization)

These are identified improvement directions that affect the broader project architecture, not part of this TUI redesign:

| # | Direction | Why Deferred |
|---|-----------|--------------|
| 1 | Room public API (replace `_decisions` private attrs with `get_dashboard()`) | Requires room service changes |
| 2 | Event-driven UI sync (room events → reactive state) | Requires event bus wiring to TUI |
| 3 | Secretary as unified entry point (intent → tui.py → secretary service) | Requires secretary service refactor |
| 4 | Conversation as first-class Pydantic model with persistence | Requires new model + migration |
| 5 | Structured streaming protocol (replace `<thinking>` XML with typed events) | Requires gateway/LLM layer change |
| 6 | Config/Skills/Agents management UI screens | New screens, can build after base TUI |
| 7 | i18n extraction (hardcoded Chinese → locale files) | Cross-cutting; separate project |
| 8 | MCP connection status UI | Requires MCP layer API |
