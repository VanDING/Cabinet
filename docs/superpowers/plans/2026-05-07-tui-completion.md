# TUI 彻底完成 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Textual TUI migration — reactive state refactor, connect all disconnected widgets, implement completion/history/slash commands, remove old Rich code.

**Architecture:** Refactor CockpitScreen to use `textual.reactive` + `watch_*` for automatic UI updates; connect InputArea with keyboard history navigation and completion popup overlay; implement 6 missing slash commands; remove deprecated `tui.py`, `tui_components.py`, and `prompt-toolkit` dependency.

**Tech Stack:** Python 3.12+, Textual >=0.86

---

## Phase 1: Reactive State Refactor

---

### Task 1: Migrate CockpitState to Reactive Attributes on CockpitScreen

**Files:**
- Modify: `src/cabinet/cli/screens/cockpit.py`

- [ ] **Step 1: Write failing test for reactive defaults**

Create `tests/unit/cli/test_cockpit.py`:

```python
from __future__ import annotations

from cabinet.cli.screens.cockpit import CockpitScreen


def test_cockpit_screen_reactive_defaults():
    """Verify reactive attributes have correct defaults."""
    # We cannot instantiate CockpitScreen without runtime, but we can check class-level defaults
    assert CockpitScreen.mode.default == "decision"
    assert CockpitScreen.token_count.default == 0
    assert CockpitScreen.elapsed_seconds.default == 0
    assert CockpitScreen.secretary_message.default == ""
    assert CockpitScreen.secretary_urgent.default is False
    assert CockpitScreen.captain_id.default == ""
    assert CockpitScreen.api_connected.default is True


def test_cockpit_screen_thinking_defaults():
    assert CockpitScreen.thinking_steps.default == []
    assert CockpitScreen.thinking_expanded.default is False


def test_cockpit_screen_panel_defaults():
    assert CockpitScreen.meeting_topic.default == ""
    assert CockpitScreen.meeting_advisors.default == 0
    assert CockpitScreen.decision_red.default == 0
    assert CockpitScreen.office_workflow.default == ""
    assert CockpitScreen.office_progress.default == 0.0
```

Run: `pytest tests/unit/cli/test_cockpit.py -v`
Expected: FAIL (ImportError: cannot import CockpitScreen or reactive attrs not found)

- [ ] **Step 2: Add reactive imports and attribute declarations to CockpitScreen**

Read `src/cabinet/cli/screens/cockpit.py`. Replace the `from cabinet.cli.state import CockpitState` import and `self.state = CockpitState()` usage with reactive class attributes.

At the top of the file, add:

```python
from textual.reactive import reactive
```

Replace the `__init__` method:

```python
class CockpitScreen(Screen):
    """Main cockpit TUI screen."""

    BINDINGS = [
        ("ctrl+t", "toggle_thinking", "Toggle Thinking"),
        ("ctrl+c", "request_quit", "Quit"),
    ]

    # ── Reactive state (replaces CockpitState dataclass) ──
    mode: reactive[str] = reactive("decision")
    token_count: reactive[int] = reactive(0)
    elapsed_seconds: reactive[int] = reactive(0)
    secretary_message: reactive[str] = reactive("")
    secretary_urgent: reactive[bool] = reactive(False)
    captain_id: reactive[str] = reactive("")
    api_connected: reactive[bool] = reactive(True)

    conversation: reactive[list[dict]] = reactive(list)
    streaming_content: reactive[str] = reactive("")

    thinking_steps: reactive[list[str]] = reactive(list)
    thinking_expanded: reactive[bool] = reactive(False)

    meeting_topic: reactive[str] = reactive("")
    meeting_advisors: reactive[int] = reactive(0)
    meeting_round: reactive[int] = reactive(0)
    decision_red: reactive[int] = reactive(0)
    decision_yellow: reactive[int] = reactive(0)
    decision_blue: reactive[int] = reactive(0)
    office_workflow: reactive[str] = reactive("")
    office_progress: reactive[float] = reactive(0.0)
    office_current_node: reactive[str] = reactive("")

    def __init__(self, runtime, config, data_dir: str):
        super().__init__()
        self.runtime = runtime
        self.config = config
        self.data_dir = data_dir
        # No more self.state = CockpitState()
```

Update `on_mount` to add timer:

```python
def on_mount(self) -> None:
    self.set_interval(1, self._tick)
    self._greet()
```

Add timer helper:

```python
def _tick(self) -> None:
    self.elapsed_seconds += 1

def _format_elapsed(self) -> str:
    h, rem = divmod(self.elapsed_seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}"
```

- [ ] **Step 3: Update all `self.state.X` references to `self.X` in cockpit.py**

Replace every `self.state.xxx` with `self.xxx` throughout the file. The following replacements are needed:

In `_greet()`:
```python
# Before:
self.state.secretary_message = greeting.message
self.state.captain_id = self.config.organization.captain_id

# After:
self.secretary_message = greeting.message
self.captain_id = self.config.organization.captain_id
```

In `_execute_and_respond()`:
```python
# Before:
self.state.secretary_message = feedback

# After:
self.secretary_message = feedback
```

In `_stream_chat()`:
```python
# Before:
recent = self.state.conversation[-10:]
...
    captain_id=self.state.captain_id,
...
self.state.conversation.append(...)
self.state.token_count += response.usage.get("total_tokens", 0)
...
self.state.conversation.append({...})

# After:
recent = self.conversation[-10:]
...
    captain_id=self.captain_id,
...
self.conversation.append(...)
self.token_count += response.usage.get("total_tokens", 0)
...
self.conversation.append({...})
```

In `_handle_slash_command()`:
```python
# Before:
self.state.mode = cmd.lstrip("/")
...
mode_names.get(self.state.mode, self.state.mode)
...
self.state.token_count, "0:00", self.state.mode

# After:
self.mode = cmd.lstrip("/")
...
mode_names.get(self.mode, self.mode)
...
self.token_count, self._format_elapsed(), self.mode
```

In `_handle_status()`:
```python
# Before:
self.state.secretary_message = result.digest
self.state.secretary_urgent = result.urgent_count > 0

# After:
self.secretary_message = result.digest
self.secretary_urgent = result.urgent_count > 0
```

In `action_toggle_thinking()`:
```python
# Before:
self.state.thinking_expanded = not self.state.thinking_expanded

# After:
self.thinking_expanded = not self.thinking_expanded
```

Remove the import of `CockpitState`:
```python
# Remove this line:
from cabinet.cli.state import CockpitState
```

- [ ] **Step 4: Run tests to verify reactive defaults**

Run: `pytest tests/unit/cli/test_cockpit.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add tests/unit/cli/test_cockpit.py src/cabinet/cli/screens/cockpit.py
git commit -m "refactor(tui): migrate CockpitState to textual.reactive on CockpitScreen"
```

---

### Task 2: Implement watch_* Methods + Session Timer

**Files:**
- Modify: `src/cabinet/cli/screens/cockpit.py`
- Modify: `tests/unit/cli/test_cockpit.py`

- [ ] **Step 1: Write tests for watch_* callbacks**

Add to `tests/unit/cli/test_cockpit.py`:

```python
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from cabinet.cli.screens.cockpit import CockpitScreen


def test_format_elapsed():
    """Test _format_elapsed formatting."""
    # We test the static method-like behavior: create a screen mock
    screen = MagicMock(spec=CockpitScreen)
    screen.elapsed_seconds = 0
    result = CockpitScreen._format_elapsed(screen)
    assert result == "0:00:00"

    screen.elapsed_seconds = 65
    result = CockpitScreen._format_elapsed(screen)
    assert result == "0:01:05"

    screen.elapsed_seconds = 3661
    result = CockpitScreen._format_elapsed(screen)
    assert result == "1:01:01"


def test_mode_labels_exist():
    """Verify MODE_LABELS in Header covers all modes."""
    from cabinet.cli.widgets.header import Header
    assert "decision" in Header.MODE_LABELS
    assert "meeting" in Header.MODE_LABELS
    assert "office" in Header.MODE_LABELS
    assert "summary" in Header.MODE_LABELS


def test_split_thinking_steps():
    """_split_thinking_steps still works for thinking tag parsing."""
    # Import from wherever it ends up — we'll keep it in cockpit.py
    from cabinet.cli.screens.cockpit import _split_thinking_steps
    result = _split_thinking_steps("第一步\n第二步\n\n第三步")
    assert result == ["第一步", "第二步", "第三步"]


def test_split_thinking_steps_empty():
    from cabinet.cli.screens.cockpit import _split_thinking_steps
    assert _split_thinking_steps("") == []


def test_split_thinking_steps_whitespace_only():
    from cabinet.cli.screens.cockpit import _split_thinking_steps
    assert _split_thinking_steps("   \n  \n  ") == []
```

Run: `pytest tests/unit/cli/test_cockpit.py::test_format_elapsed -v`
Expected: FAIL (method not yet defined or `_split_thinking_steps` not importable)

- [ ] **Step 2: Add watch_* methods to CockpitScreen**

Add to `cockpit.py`, after the `_tick` method:

```python
# ── watch methods (auto-triggered on reactive change) ──

def watch_mode(self, old: str, new: str) -> None:
    header = self.query_one("#header", Header)
    header.update_info(self.token_count, self._format_elapsed(), new)
    self._sync_panels()

def watch_token_count(self, old: int, new: int) -> None:
    self.query_one("#header", Header).update_info(
        new, self._format_elapsed(), self.mode
    )

def watch_elapsed_seconds(self, old: int, new: int) -> None:
    self.query_one("#header", Header).update_info(
        self.token_count, self._format_elapsed(), self.mode
    )

def watch_secretary_message(self, old: str, new: str) -> None:
    bar = self.query_one("#secretary-bar", Static)
    bar.update(f"\U0001f4cb 秘书：{new}" if new else "\U0001f4cb 秘书：Captain，一切正常")

def watch_secretary_urgent(self, old: bool, new: bool) -> None:
    bar = self.query_one("#secretary-bar", Static)
    if new:
        bar.add_class("urgent")
    else:
        bar.remove_class("urgent")

def watch_thinking_steps(self, old, new) -> None:
    self.query_one("#thinking-panel", ThinkingPanel).update_state(
        new, self.thinking_expanded
    )

def watch_thinking_expanded(self, old, new) -> None:
    self.query_one("#thinking-panel", ThinkingPanel).update_state(
        self.thinking_steps, new
    )

def watch_meeting_topic(self, old, new) -> None:
    self._sync_panels()

def watch_decision_red(self, old, new) -> None:
    self._sync_panels()

def watch_office_workflow(self, old, new) -> None:
    self._sync_panels()
```

- [ ] **Step 3: Move `_split_thinking_steps` to cockpit.py**

Add this function to `cockpit.py` (it's needed for thinking tag parsing later):

```python
def _split_thinking_steps(raw: str) -> list[str]:
    """Split raw thinking content into steps by newlines, filter empty lines."""
    return [line.strip() for line in raw.strip().split("\n") if line.strip()]
```

- [ ] **Step 4: Update `_greet()` to use reactive assignment instead of manual query_one().update()**

In `cockpit.py`, replace the `_greet` method:

```python
async def _greet(self) -> None:
    try:
        greeting = await self.runtime.secretary.greet(
            captain_id=self.config.organization.captain_id
        )
        self.captain_id = self.config.organization.captain_id
        self.secretary_message = greeting.message  # watch_secretary_message auto-updates UI
    except Exception:
        self.secretary_message = "秘书服务连接失败"
```

- [ ] **Step 5: Update `_execute_and_respond()` to use reactive assignment**

```python
async def _execute_and_respond(self, intent: dict, user_input: str) -> None:
    feedback = await execute_intent(intent, self, self.runtime)
    if feedback:
        self.secretary_message = feedback  # watch auto-updates
        self.query_one("#conversation-view", ConversationView).add_assistant_message(
            f"\U0001f4cb {feedback}"
        )
```

- [ ] **Step 6: Update `_handle_slash_command()` to use reactive assignment**

```python
def _handle_slash_command(self, text: str) -> None:
    cmd = text.split()[0]
    if cmd in ("/decision", "/meeting", "/office", "/summary"):
        self.mode = cmd.lstrip("/")  # watch_mode auto-updates Header + panels
        mode_names = {
            "decision": "决策室", "meeting": "会议室",
            "office": "办公室", "summary": "总结室",
        }
        self.secretary_message = f"已切换至{mode_names[self.mode]}"
    elif cmd == "/status":
        self.run_worker(self._handle_status())
    elif cmd == "/help":
        self._show_help()
    else:
        self.secretary_message = f"未知命令: {cmd}，输入 /help 查看帮助"
```

- [ ] **Step 7: Update `_handle_status()` to use reactive assignment**

```python
async def _handle_status(self) -> None:
    try:
        result = await self.runtime.secretary.summarize_pending(
            captain_id=self.captain_id
        )
        self.secretary_message = result.digest
        self.secretary_urgent = result.urgent_count > 0
    except Exception as e:
        self.secretary_message = f"获取状态失败: {e}"
```

- [ ] **Step 8: Run tests**

Run: `pytest tests/unit/cli/test_cockpit.py -v`
Expected: all pass (8 tests)

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/cli/screens/cockpit.py tests/unit/cli/test_cockpit.py
git commit -m "feat(tui): add watch_* methods, session timer, and reactive UI updates"
```

---

### Task 3: Decouple side_panels.py from CockpitState, Update state.py

**Files:**
- Modify: `src/cabinet/cli/widgets/side_panels.py`
- Modify: `src/cabinet/cli/state.py`

- [ ] **Step 1: Update failing tests for side_panels signatures**

Create `tests/unit/cli/test_side_panels.py`:

```python
from __future__ import annotations

from cabinet.cli.widgets.side_panels import MeetingPanel, DecisionPanel, OfficePanel


def test_meeting_panel_update_state_with_topic():
    panel = MeetingPanel()
    panel.update_state(topic="Q3预算", advisors=3, round_num=2)
    # Should not raise — previously took CockpitState, now takes individual fields


def test_meeting_panel_update_state_idle():
    panel = MeetingPanel()
    panel.update_state(topic="", advisors=0, round_num=0)


def test_decision_panel_update_state_active():
    panel = DecisionPanel()
    panel.update_state(red=2, yellow=1, blue=3)


def test_decision_panel_update_state_idle():
    panel = DecisionPanel()
    panel.update_state(red=0, yellow=0, blue=0)


def test_office_panel_update_state_with_workflow():
    panel = OfficePanel()
    panel.update_state(workflow="代码审查", progress=0.5, current_node="review")


def test_office_panel_update_state_idle():
    panel = OfficePanel()
    panel.update_state(workflow="", progress=0.0, current_node="")
```

Run: `pytest tests/unit/cli/test_side_panels.py -v`
Expected: FAIL (old signatures incompatible)

- [ ] **Step 2: Update side_panels.py method signatures**

Read `src/cabinet/cli/widgets/side_panels.py`. Change each `update_state` method to accept individual fields instead of `CockpitState`:

```python
# MeetingPanel.update_state:
# Before:
def update_state(self, state: CockpitState) -> None:
    if state.meeting_topic:
        self.query_one("#meeting-content").update(
            f"议题: {state.meeting_topic}\n"
            f"顾问: {state.meeting_advisors} · 轮次: {state.meeting_round}"
        )
    else:
        self.query_one("#meeting-content").update("Idle")

# After:
def update_state(self, topic: str = "", advisors: int = 0, round_num: int = 0) -> None:
    if topic:
        self.query_one("#meeting-content").update(
            f"议题: {topic}\n"
            f"顾问: {advisors} · 轮次: {round_num}"
        )
    else:
        self.query_one("#meeting-content").update("Idle")
```

```python
# DecisionPanel.update_state:
# Before:
def update_state(self, state: CockpitState) -> None:
    r, y, b = state.decision_red, state.decision_yellow, state.decision_blue
    ...

# After:
def update_state(self, red: int = 0, yellow: int = 0, blue: int = 0) -> None:
    if red == yellow == blue == 0:
        self.query_one("#decision-content").update("暂无决策")
    else:
        self.query_one("#decision-content").update(
            f"\U0001f534 战略: {red}  \U0001f7e1 战术: {yellow}  \U0001f535 执行: {blue}"
        )
```

```python
# OfficePanel.update_state:
# Before:
def update_state(self, state: CockpitState) -> None:
    progress = self.query_one("#office-progress", ProgressBar)
    if state.office_workflow:
        progress.update(progress=int(state.office_progress * 100))
        self.query_one("#office-content").update(
            f"{state.office_workflow}\n当前: {state.office_current_node}"
        )
    else:
        progress.update(progress=0)
        self.query_one("#office-content").update("Idle")

# After:
def update_state(self, workflow: str = "", progress: float = 0.0, current_node: str = "") -> None:
    bar = self.query_one("#office-progress", ProgressBar)
    if workflow:
        bar.update(progress=int(progress * 100))
        self.query_one("#office-content").update(
            f"{workflow}\n当前: {current_node}"
        )
    else:
        bar.update(progress=0)
        self.query_one("#office-content").update("Idle")
```

Remove the import:
```python
# Remove:
from cabinet.cli.state import CockpitState
```

- [ ] **Step 3: Update _sync_panels in cockpit.py**

In `cockpit.py`, update `_sync_panels` to pass individual fields:

```python
def _sync_panels(self) -> None:
    self.query_one("#meeting-panel", MeetingPanel).update_state(
        topic=self.meeting_topic,
        advisors=self.meeting_advisors,
        round_num=self.meeting_round,
    )
    self.query_one("#decision-panel", DecisionPanel).update_state(
        red=self.decision_red,
        yellow=self.decision_yellow,
        blue=self.decision_blue,
    )
    self.query_one("#office-panel", OfficePanel).update_state(
        workflow=self.office_workflow,
        progress=self.office_progress,
        current_node=self.office_current_node,
    )
```

- [ ] **Step 4: Simplify state.py**

Read `src/cabinet/cli/state.py`. Replace its content with a compatibility re-export:

```python
"""DEPRECATED: CockpitState has been migrated to textual.reactive on CockpitScreen.

Import CockpitScreen directly:
    from cabinet.cli.screens.cockpit import CockpitScreen

Or access reactive attributes directly on the screen instance.
"""

from __future__ import annotations

# Backward-compat: re-export CockpitScreen for any code importing from state.py
from cabinet.cli.screens.cockpit import CockpitScreen as _CockpitScreen

# Provide a dataclass-like interface for code still expecting CockpitState
# This is a thin wrapper that delegates to CockpitScreen reactive attrs
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/unit/cli/test_side_panels.py tests/unit/cli/test_cockpit.py -v`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/cli/widgets/side_panels.py src/cabinet/cli/state.py src/cabinet/cli/screens/cockpit.py tests/unit/cli/test_side_panels.py
git commit -m "refactor(tui): decouple side_panels from CockpitState, use individual field params"
```

---

## Phase 2: Feature Completion

---

### Task 4: Connect InputArea to CockpitScreen + Keyboard History Navigation

**Files:**
- Modify: `src/cabinet/cli/screens/cockpit.py` (compose: replace raw Input with InputArea)
- Modify: `src/cabinet/cli/widgets/input_area.py` (add BINDINGS, action_history_prev/next)
- Expand: `tests/unit/cli/test_widgets_input_area.py`

- [ ] **Step 1: Write failing tests for history navigation**

Add to `tests/unit/cli/test_widgets_input_area.py`:

```python
from pathlib import Path
import tempfile
import os

from cabinet.cli.widgets.input_area import InputArea, SLASH_COMMANDS_LIST


def test_input_area_history_add():
    """Adding to history stores entries."""
    with tempfile.TemporaryDirectory() as tmpdir:
        area = InputArea(data_dir=tmpdir)
        area._add_to_history("hello")
        assert "hello" in area._history


def test_input_area_history_no_duplicates():
    """Consecutive duplicates are not stored."""
    with tempfile.TemporaryDirectory() as tmpdir:
        area = InputArea(data_dir=tmpdir)
        area._add_to_history("hello")
        area._add_to_history("hello")
        assert area._history == ["hello"]


def test_input_area_history_max_entries():
    """History is truncated to last 1000 entries."""
    with tempfile.TemporaryDirectory() as tmpdir:
        area = InputArea(data_dir=tmpdir)
        for i in range(1500):
            area._add_to_history(f"cmd_{i}")
        assert len(area._history) <= 1000


def test_input_area_history_persisted():
    """History is saved to and loaded from file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        area1 = InputArea(data_dir=tmpdir)
        area1._add_to_history("test_command")
        
        area2 = InputArea(data_dir=tmpdir)
        assert "test_command" in area2._history


def test_input_area_has_slash_commands():
    """SLASH_COMMANDS_LIST contains all expected commands."""
    assert "/decision" in SLASH_COMMANDS_LIST
    assert "/meeting" in SLASH_COMMANDS_LIST
    assert "/office" in SLASH_COMMANDS_LIST
    assert "/summary" in SLASH_COMMANDS_LIST
    assert "/decide" in SLASH_COMMANDS_LIST
    assert "/task" in SLASH_COMMANDS_LIST
    assert "/strategy" in SLASH_COMMANDS_LIST
    assert "/review" in SLASH_COMMANDS_LIST
    assert "/skills" in SLASH_COMMANDS_LIST
    assert "/employees" in SLASH_COMMANDS_LIST
    assert "/status" in SLASH_COMMANDS_LIST
    assert "/help" in SLASH_COMMANDS_LIST
    assert "/quit" in SLASH_COMMANDS_LIST
```

Run: `pytest tests/unit/cli/test_widgets_input_area.py::test_input_area_history_add -v`
Expected: some tests may pass (existing code works), but `test_input_area_has_slash_commands` should pass already

- [ ] **Step 2: Add BINDINGS and action_history_prev/next to InputArea**

Read `src/cabinet/cli/widgets/input_area.py`. Add to the `InputArea` class:

```python
from textual.widgets import Input, ListView, ListItem, Static


class InputArea(Vertical):
    """Input area with command completion overlay."""

    BINDINGS = [
        ("up", "history_prev", "Previous command"),
        ("down", "history_next", "Next command"),
    ]

    # ... existing __init__ ...

    def action_history_prev(self) -> None:
        if not self._history:
            return
        if self._history_index < len(self._history) - 1:
            self._history_index += 1
        idx = len(self._history) - 1 - self._history_index
        inp = self.query_one("#prompt-input", Input)
        inp.value = self._history[idx]
        inp.cursor_position = len(inp.value)

    def action_history_next(self) -> None:
        if self._history_index <= 0:
            self._history_index = -1
            self.query_one("#prompt-input", Input).value = ""
            return
        self._history_index -= 1
        idx = len(self._history) - 1 - self._history_index
        self.query_one("#prompt-input", Input).value = self._history[idx]
```

- [ ] **Step 3: Replace raw Input with InputArea in CockpitScreen.compose()**

Read `cockpit.py`. In `compose()`, change:

```python
# Before (last line of compose):
yield Input(placeholder="decision > ", id="prompt-input")

# After:
from cabinet.cli.widgets.input_area import InputArea
# ...
yield InputArea(data_dir=self.data_dir, id="input-area")
```

Remove the `Input` import if it's no longer used:
```python
# Change:
from textual.widgets import Input, Static
# To:
from textual.widgets import Static
```

- [ ] **Step 4: Update on_input_submitted in cockpit.py**

The `on_input_submitted` handler currently references `event.input` — this still works because `InputArea` contains the `Input` widget and the event bubbles up. But we should verify the event chain works.

No code change needed — the existing `on_input_submitted` handler matches on `Input.Submitted` which bubbles from the Input inside InputArea.

- [ ] **Step 5: Run tests**

Run: `pytest tests/unit/cli/test_widgets_input_area.py -v`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/cli/widgets/input_area.py src/cabinet/cli/screens/cockpit.py tests/unit/cli/test_widgets_input_area.py
git commit -m "feat(tui): connect InputArea to CockpitScreen, add keyboard history navigation"
```

---

### Task 5: Implement Completion Popup (ListView Overlay)

**Files:**
- Modify: `src/cabinet/cli/widgets/input_area.py`

- [ ] **Step 1: Write failing test for completion filtering**

Add to `tests/unit/cli/test_widgets_input_area.py`:

```python
from cabinet.cli.widgets.input_area import _filter_completions, SLASH_COMMAND_DESCRIPTIONS


def test_filter_completions_partial_slash():
    result = _filter_completions("/dec")
    assert "/decision" in result
    assert "/decide" in result


def test_filter_completions_exact():
    result = _filter_completions("/decision")
    assert result == ["/decision"]


def test_filter_completions_no_match():
    result = _filter_completions("/xyz")
    assert result == []


def test_filter_completions_plain_text():
    result = _filter_completions("hello")
    assert result == []


def test_filter_completions_empty():
    result = _filter_completions("")
    assert result == []


def test_slash_command_descriptions():
    assert SLASH_COMMAND_DESCRIPTIONS["/decision"] == "切换决策室"
    assert SLASH_COMMAND_DESCRIPTIONS["/help"] == "显示帮助"
```

Run: `pytest tests/unit/cli/test_widgets_input_area.py::test_filter_completions_partial_slash -v`
Expected: PASS (function already exists)

- [ ] **Step 2: Replace pass stubs with ListView-based completion popup**

Read `input_area.py`. Update `compose()`:

```python
def compose(self) -> ComposeResult:
    yield ListView(id="completion-list", classes="completion-overlay")
    yield Input(placeholder="decision > ", id="prompt-input")
```

Update `_show_completions` and `_hide_completions`:

```python
def _show_completions(self, matches: list[str]) -> None:
    lv = self.query_one("#completion-list", ListView)
    lv.clear()
    for m in matches:
        desc = SLASH_COMMAND_DESCRIPTIONS.get(m, "")
        item_text = f"{m}  {desc}" if desc else m
        lv.append(ListItem(Static(item_text)))
    lv.display = True
    self._completion_visible = True

def _hide_completions(self) -> None:
    self.query_one("#completion-list", ListView).display = False
    self._completion_visible = False
```

Add `on_list_view_selected` handler:

```python
def on_list_view_selected(self, event: ListView.Selected) -> None:
    """When user selects a completion item, fill the input."""
    static_widget = event.item.query_one(Static)
    text = str(static_widget.renderable)
    cmd = text.split()[0]  # Extract "/decision" from "/decision  切换决策室"
    inp = self.query_one("#prompt-input", Input)
    inp.value = cmd + " "
    inp.cursor_position = len(inp.value)
    self._hide_completions()
```

Ensure imports include `Static`:
```python
from textual.widgets import Input, ListView, ListItem, Static
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/unit/cli/test_widgets_input_area.py -v`
Expected: all pass (11 tests including previous)

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/widgets/input_area.py tests/unit/cli/test_widgets_input_area.py
git commit -m "feat(tui): implement completion popup with ListView overlay"
```

---

### Task 6: Mode-Aware Placeholder + _sync_panels Connection

**Files:**
- Modify: `src/cabinet/cli/widgets/input_area.py` (add set_placeholder)
- Modify: `src/cabinet/cli/screens/cockpit.py` (watch_mode calls set_placeholder)

- [ ] **Step 1: Add set_placeholder to InputArea**

Read `input_area.py`. Add after the class docstring:

```python
PLACEHOLDERS = {
    "decision": "decision > ",
    "meeting": "meeting > ",
    "office": "office > ",
    "summary": "summary > ",
}

def set_placeholder(self, mode: str) -> None:
    """Update input placeholder based on current room mode."""
    placeholder = self.PLACEHOLDERS.get(mode, f"{mode} > ")
    self.query_one("#prompt-input", Input).placeholder = placeholder
```

- [ ] **Step 2: Call set_placeholder from watch_mode**

In `cockpit.py`, update `watch_mode`:

```python
def watch_mode(self, old: str, new: str) -> None:
    header = self.query_one("#header", Header)
    header.update_info(self.token_count, self._format_elapsed(), new)
    input_area = self.query_one("#input-area")
    if input_area is not None:
        input_area.set_placeholder(new)
    self._sync_panels()
```

- [ ] **Step 3: Verify _sync_panels is called from intent handlers**

In `_execute_and_respond()`, after setting mode, the `watch_mode` callback automatically calls `_sync_panels`. For intent handlers that set sidebar data directly (like `execute_intent` in `intent.py`), the intent function sets reactive attributes which trigger `watch_*` → `_sync_panels`. No explicit call needed.

Verify that `execute_intent` in `intent.py` sets attributes on the screen object (which now has reactive attrs instead of `state.xxx`). Read `src/cabinet/cli/intent.py` and update references:

```python
# In execute_intent, change:
state.mode = "meeting"
state.meeting_topic = intent["topic"]
# To:
screen.mode = "meeting"
screen.meeting_topic = intent["topic"]
```

The `execute_intent` signature already receives `state` (the CockpitScreen instance), so rename the parameter for clarity:

```python
# In intent.py execute_intent signature:
# Before:
async def execute_intent(intent: dict, state, runtime) -> str | None:

# After:
async def execute_intent(intent: dict, screen, runtime) -> str | None:
    # Replace all state.xxx with screen.xxx inside the function
```

Update calls in `cockpit.py`:
```python
# In _execute_and_respond and _execute_slash_intent:
feedback = await execute_intent(intent, self, self.runtime)
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/cli/test_cockpit.py tests/unit/cli/test_side_panels.py tests/unit/cli/test_intent.py -v`
Expected: all pass (may need to update test_intent.py mocks to pass CockpitScreen-like object)

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/widgets/input_area.py src/cabinet/cli/screens/cockpit.py src/cabinet/cli/intent.py
git commit -m "feat(tui): add mode-aware placeholder, connect _sync_panels via watch_*"
```

---

### Task 7: ThinkingPanel Parsing + Slash Commands Completion

**Files:**
- Modify: `src/cabinet/cli/screens/cockpit.py` (thinking tag parsing, 6 slash commands)

- [ ] **Step 1: Write failing tests for slash commands**

Add to `tests/unit/cli/test_cockpit.py`:

```python
def test_slash_command_mode_switch():
    """Test that /decision, /meeting etc set mode via reactive."""
    # We test the parsing logic statically
    from cabinet.cli.screens.cockpit import CockpitScreen

    # Verify the mode-switch commands are recognized
    mode_commands = ["/decision", "/meeting", "/office", "/summary"]
    for cmd in mode_commands:
        mode = cmd.lstrip("/")
        assert mode in ("decision", "meeting", "office", "summary")


def test_slash_commands_list_complete():
    """All 13 slash commands should be in the recognized set."""
    expected = {
        "/decision", "/meeting", "/office", "/summary",
        "/decide", "/task", "/strategy", "/review",
        "/skills", "/employees", "/status", "/help", "/quit",
    }
    from cabinet.cli.widgets.input_area import SLASH_COMMANDS_LIST
    assert set(SLASH_COMMANDS_LIST) == expected


def test_thinking_tag_regex():
    """THINKING_RE extracts thinking content."""
    import re
    THINKING_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL)

    text = "Hello<thinking>step1\nstep2</thinking>World"
    m = THINKING_RE.search(text)
    assert m is not None
    assert m.group(1) == "step1\nstep2"

    result = THINKING_RE.sub("", text).strip()
    assert result == "HelloWorld"

    # No thinking tag
    assert THINKING_RE.search("No thinking here") is None
```

Run: `pytest tests/unit/cli/test_cockpit.py::test_thinking_tag_regex -v`
Expected: PASS (regex test is self-contained)

- [ ] **Step 2: Add thinking tag parsing in _stream_chat**

In `cockpit.py`, add at module level:

```python
import re
_THINKING_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL)
```

In `_stream_chat`, after collecting chunks:

```python
final_text = "".join(chunks)

# Extract thinking chain
m = _THINKING_RE.search(final_text)
if m:
    steps = _split_thinking_steps(m.group(1))
    self.thinking_steps = steps  # watch_thinking_steps auto-updates ThinkingPanel
    final_text = _THINKING_RE.sub("", final_text).strip()
```

- [ ] **Step 3: Add 6 missing slash commands to _handle_slash_command**

In `cockpit.py`, replace `_handle_slash_command` with:

```python
def _handle_slash_command(self, text: str) -> None:
    """Handle slash commands (mode switches, actions, info)."""
    parts = text.split(maxsplit=1)
    cmd = parts[0]
    arg = parts[1] if len(parts) > 1 else ""

    mode_names = {
        "decision": "决策室", "meeting": "会议室",
        "office": "办公室", "summary": "总结室",
    }

    if cmd in ("/decision", "/meeting", "/office", "/summary"):
        self.mode = cmd.lstrip("/")
        self.secretary_message = f"已切换至{mode_names[self.mode]}"
    elif cmd == "/decide" and arg:
        self.run_worker(self._execute_slash_intent("decision", arg))
    elif cmd == "/task" and arg:
        self.run_worker(self._execute_slash_intent("office", arg))
    elif cmd == "/strategy" and arg:
        self.run_worker(self._execute_slash_intent("decision", arg))
    elif cmd == "/review":
        self.mode = "summary"
        self.run_worker(self._stream_chat("请启动项目复盘"))
    elif cmd == "/skills":
        self.run_worker(self._show_skills())
    elif cmd == "/employees":
        self.run_worker(self._show_employees())
    elif cmd == "/status":
        self.run_worker(self._handle_status())
    elif cmd == "/help":
        self._show_help()
    elif cmd == "/quit":
        self.app.exit()
    else:
        self.secretary_message = f"未知命令: {cmd}，输入 /help 查看帮助"
```

Add the new helper methods:

```python
async def _execute_slash_intent(self, intent_type: str, arg: str) -> None:
    """Execute intent from slash command with argument."""
    from cabinet.cli.intent import execute_intent

    intent_map = {
        "decision": {"type": "decision", "title": arg,
                     "action_text": f"已提交决策「{arg}」"},
        "office": {"type": "office", "description": arg,
                   "action_text": f"已添加待办「{arg}」"},
    }
    intent = intent_map[intent_type]
    feedback = await execute_intent(intent, self, self.runtime)
    if feedback:
        self.secretary_message = feedback
        self.query_one("#conversation-view", ConversationView).add_assistant_message(
            f"\U0001f4cb {feedback}"
        )

async def _show_skills(self) -> None:
    """List registered skills in conversation view."""
    conversation = self.query_one("#conversation-view", ConversationView)
    try:
        skills = getattr(self.runtime.tool_registry, "_skills", {})
        if skills:
            lines = ["**已注册技能:**"]
            for s in list(skills.values())[:20]:
                lines.append(f"- **{s.name}**: {s.description or '无描述'}")
            conversation.add_assistant_message("\n".join(lines))
        else:
            conversation.add_assistant_message("暂无注册技能")
    except Exception as e:
        conversation.add_assistant_message(f"获取技能列表失败: {e}")

async def _show_employees(self) -> None:
    """List registered employees in conversation view."""
    conversation = self.query_one("#conversation-view", ConversationView)
    try:
        employees = getattr(self.runtime, "employee_store", None)
        if employees and hasattr(employees, "list_all"):
            emp_list = employees.list_all()
            if emp_list:
                lines = ["**注册员工:**"]
                for e in emp_list:
                    lines.append(f"- **{e.name}** ({e.role}): {e.personality or ''}")
                conversation.add_assistant_message("\n".join(lines))
            else:
                conversation.add_assistant_message("暂无注册员工")
        else:
            conversation.add_assistant_message("暂无注册员工")
    except Exception as e:
        conversation.add_assistant_message(f"获取员工列表失败: {e}")
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/cli/test_cockpit.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/screens/cockpit.py tests/unit/cli/test_cockpit.py
git commit -m "feat(tui): add thinking tag parsing and 6 missing slash commands"
```

---

## Phase 3: Cleanup

---

### Task 8: Delete Old Code + Remove prompt-toolkit Dependency

**Files:**
- Delete: `src/cabinet/cli/tui.py`
- Delete: `src/cabinet/cli/tui_components.py`
- Modify: `src/cabinet/cli/tui_themes.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: Grep for remaining imports of tui.py and tui_components.py**

Run:
```bash
grep -rn "from cabinet.cli.tui import\|from cabinet.cli import tui\|import cabinet.cli.tui" src/ tests/ --include="*.py"
grep -rn "from cabinet.cli.tui_components import\|import cabinet.cli.tui_components" src/ tests/ --include="*.py"
```

Expected: Only found in the files being deleted or in test files being removed. Note any unexpected imports and handle them.

- [ ] **Step 2: Grep for prompt_toolkit usage outside of files being deleted**

Run:
```bash
grep -rn "prompt_toolkit" src/ --include="*.py" | grep -v "tui.py" | grep -v "tui_themes.py" | grep -v "tui_components.py"
```

Expected: No remaining prompt_toolkit imports in src/ after removal.

- [ ] **Step 3: Remove prompt_toolkit from pyproject.toml**

Read `pyproject.toml`. Find the `dependencies` list. Remove `"prompt-toolkit>=3.0"`.

- [ ] **Step 4: Simplify tui_themes.py**

Read `src/cabinet/cli/tui_themes.py`. Remove the `prompt_toolkit` import and `INPUT_STYLE`:

```python
# Remove:
from prompt_toolkit.styles import Style as PromptStyle
...
INPUT_STYLE = PromptStyle.from_dict({...})
```

Keep only:
```python
from __future__ import annotations

from rich.style import Style

CABINET_BLUE = "#3B82F6"
CABINET_RED = "#CB220C"
CABINET_YELLOW = "#EDB61B"

STYLE_DEFAULT = Style(color="#E2E8F0")
STYLE_BLUE_BOLD = Style(color=CABINET_BLUE, bold=True)
STYLE_RED_BOLD = Style(color=CABINET_RED, bold=True)
STYLE_YELLOW_BOLD = Style(color=CABINET_YELLOW, bold=True)
STYLE_DIM = Style(color="#64748B", dim=True)
STYLE_BLUE = Style(color=CABINET_BLUE)
STYLE_SUCCESS = Style(color="#22C55E")

CABINET_LOGO = """..."""  # keep unchanged
```

- [ ] **Step 5: Delete tui.py and tui_components.py**

```bash
git rm src/cabinet/cli/tui.py src/cabinet/cli/tui_components.py
```

- [ ] **Step 6: Update test_tui.py — remove prompt_toolkit-dependent tests**

Read `tests/unit/cli/test_tui.py`. Most tests reference `from cabinet.cli.tui import ...`. These need to be migrated to `test_cockpit.py`. But we already have `test_cockpit.py` with the core tests. Delete `test_tui.py`:

```bash
git rm tests/unit/cli/test_tui.py
```

Delete `tests/unit/cli/test_tui_components.py`:
```bash
git rm tests/unit/cli/test_tui_components.py
```

- [ ] **Step 7: Update test_tui_themes.py**

Read `tests/unit/cli/test_tui_themes.py`. Remove any tests that reference `INPUT_STYLE` or `prompt_toolkit`. Keep tests for color constants and `CABINET_LOGO`.

- [ ] **Step 8: Verify no broken imports**

Run:
```bash
python -c "
from cabinet.cli.app import CabinetApp
from cabinet.cli.screens.welcome import WelcomeScreen
from cabinet.cli.screens.cockpit import CockpitScreen
from cabinet.cli.widgets.conversation import ConversationView
from cabinet.cli.widgets.input_area import InputArea
from cabinet.cli.widgets.side_panels import MeetingPanel, DecisionPanel, OfficePanel
from cabinet.cli.widgets.header import Header
from cabinet.cli.widgets.thinking import ThinkingPanel
from cabinet.cli.tui_themes import CABINET_LOGO, CABINET_BLUE
print('All imports OK')
"
```

Expected: `All imports OK`

- [ ] **Step 9: Run remaining TUI tests**

Run: `pytest tests/unit/cli/ -v`
Expected: all remaining tests pass (test_cockpit, test_intent, test_widgets_*, test_side_panels, test_tui_themes)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore(tui): remove deprecated Rich TUI code and prompt-toolkit dependency"
```

---

### Task 9: CSS Refinements

**Files:**
- Modify: `src/cabinet/cli/cockpit.tcss`

- [ ] **Step 1: Add completion overlay and message styles to cockpit.tcss**

Read `src/cabinet/cli/cockpit.tcss`. Append the following styles:

```css
/* Completion popup overlay */
#completion-list {
    display: none;
    height: auto;
    max-height: 12;
    border: solid #3B82F6;
    background: #1a1a2e;
}

.completion-overlay {
    overlay: screen;
    dock: bottom;
}

/* Chat messages */
.user-message {
    color: #64748B;
    text-align: right;
    padding: 0 2;
}

.assistant-message {
    color: #E2E8F0;
    padding: 0 2;
}

/* Secretary bar urgent state */
#secretary-bar.urgent {
    color: #CB220C;
    text-style: bold;
}

/* Input area */
#input-area {
    height: auto;
    min-height: 3;
}

#input-area Input {
    border: solid #3B82F6;
    color: #ffffff;
}

#input-area Input:focus {
    border: solid #3B82F6;
}
```

- [ ] **Step 2: Verify CSS parses**

Run:
```bash
python -c "from textual.css.parse import parse; parse(open('src/cabinet/cli/cockpit.tcss').read(), 'cockpit.tcss'); print('CSS OK')"
```

Expected: `CSS OK`

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/cli/cockpit.tcss
git commit -m "style(tui): add completion overlay, message, and urgent CSS styles"
```

---

### Task 10: Full Integration Verification

**Files:** No production code changes

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -q --tb=line`
Expected: ~1080 passed, 0 failures (accounting for deleted test files)

- [ ] **Step 2: Run lint on all changed modules**

```bash
python -m ruff check src/cabinet/cli/screens/ src/cabinet/cli/widgets/ tests/unit/cli/
```

Expected: no errors

- [ ] **Step 3: Verify all new module imports**

```bash
python -c "
from cabinet.cli.app import CabinetApp
from cabinet.cli.screens.welcome import WelcomeScreen
from cabinet.cli.screens.cockpit import CockpitScreen, _split_thinking_steps
from cabinet.cli.widgets.input_area import InputArea, _filter_completions, SLASH_COMMANDS_LIST
from cabinet.cli.widgets.side_panels import MeetingPanel, DecisionPanel, OfficePanel
from cabinet.cli.widgets.header import Header
from cabinet.cli.widgets.thinking import ThinkingPanel
from cabinet.cli.widgets.conversation import ConversationView
from cabinet.cli.intent import detect_intent, execute_intent
from cabinet.cli.tui_themes import CABINET_LOGO, CABINET_BLUE
print('All imports OK')
"
```

Expected: `All imports OK`

- [ ] **Step 4: Verify prompt_toolkit is no longer imported**

```bash
python -c "import prompt_toolkit" 2>&1 || echo "prompt_toolkit not importable (may still be installed but not used)"
```

This is informational — prompt_toolkit may still be installed but is no longer a required dependency.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: full integration verification for TUI completion"
```

---

## File Structure After Completion

```
src/cabinet/cli/
├── main.py              # Typer entry (unchanged)
├── app.py               # CabinetApp(Textual App)
├── state.py              # DEPRECATED compat re-export
├── intent.py             # Intent detection + execution
├── cockpit.tcss          # CSS styles (updated)
├── config.py             # CabinetConfig (unchanged)
├── providers.py          # LLM providers (unchanged)
├── commands/             # 11 command modules (unchanged)
├── screens/
│   ├── welcome.py        # WelcomeScreen
│   └── cockpit.py        # CockpitScreen (reactive, complete)
├── widgets/
│   ├── header.py         # Header widget
│   ├── conversation.py   # ConversationView
│   ├── thinking.py       # ThinkingPanel
│   ├── side_panels.py    # Meeting/Decision/Office (decoupled)
│   └── input_area.py     # InputArea + completion + history
└── tui_themes.py         # Colors + CABINET_LOGO (simplified)

[DELETED]
  tui.py                  # 57 lines → GONE
  tui_components.py       # 228 lines → GONE
```

**Summary**: 2 files deleted, 1 dependency removed, 10 files modified. ~400 lines removed, ~200 lines of reactive/watch code added. Net negative code, net positive functionality.

---

## Execution Order

Tasks must run sequentially due to dependencies:
1. Task 1 → Task 2 → Task 3 (Phase 1: reactive foundation)
2. Task 4 → Task 5 → Task 6 → Task 7 (Phase 2: feature completion, depends on Phase 1)
3. Task 8 → Task 9 → Task 10 (Phase 3: cleanup, depends on Phase 2)
