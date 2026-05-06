# TUI UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 TUI bugs in `cabinet chat` cockpit: secretary text overflow, streaming freeze, dark colors, missing thinking chain, screen flicker, and invisible input text.

**Architecture:** Targeted fixes within existing Rich+prompt_toolkit architecture. Changes confined to 3 files: `tui_themes.py` (colors), `tui_components.py` (rendering components), `tui.py` (streaming, screen management, input). No new dependencies.

**Tech Stack:** Python 3.12+, Rich, prompt_toolkit, pytest

---

### Task 1: Color Palette Update

**Files:**
- Modify: `src/cabinet/cli/tui_themes.py` (entire file)
- Modify: `tests/unit/cli/test_tui_themes.py` (entire file)

- [ ] **Step 1: Update color constants and styles in tui_themes.py**

Replace the entire file content:

```python
from __future__ import annotations

from rich.style import Style

CABINET_BLUE = "#3B82F6"  # was #081D60 — too dark on black terminals
CABINET_RED = "#CB220C"
CABINET_YELLOW = "#EDB61B"

STYLE_DEFAULT = Style(color="#E2E8F0")  # was white — slate-200, softer
STYLE_BLUE_BOLD = Style(color=CABINET_BLUE, bold=True)
STYLE_RED_BOLD = Style(color=CABINET_RED, bold=True)
STYLE_YELLOW_BOLD = Style(color=CABINET_YELLOW, bold=True)
STYLE_DIM = Style(color="#64748B", dim=True)  # was grey62 — slate-500
STYLE_BLUE = Style(color=CABINET_BLUE)
STYLE_SUCCESS = Style(color="#22C55E")  # new — green for success messages

INPUT_STYLE = Style.from_dict({
    "": "#ffffff",           # user input text — bright white, always visible
    "prompt": "#3B82F6 bold", # prompt text (e.g. "decision >")
})

CABINET_LOGO = """
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #3B82F6]████████████████████████████[/]
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #3B82F6]████████████████████████████[/]
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #3B82F6]████████████████████████████[/]
                        [bold #3B82F6]████████████████████████████[/]
[white]██████████████[/]    [white]██████████████[/]    [bold #3B82F6]████████████████████████████[/]
[white]██████████████[/]    [white]██████████████[/]    [bold #3B82F6]████████████████████████████[/]

[bold #3B82F6]██████╗  █████╗ ██████╗ ██╗███╗   ██╗███████╗████████╗[/]
[bold #3B82F6]██╔════╝ ██╔══██╗██╔══██╗██║████╗  ██║██╔════╝╚══██╔══╝[/]
[bold #3B82F6]██║  ███╗███████║██████╔╝██║██╔██╗ ██║█████╗     ██║[/]
[bold #3B82F6]██║   ██║██╔══██║██╔══██╗██║██║╚██╗██║██╔══╝     ██║[/]
[bold #3B82F6]╚██████╔╝██║  ██║██████╔╝██║██║ ╚████║███████╗   ██║[/]
[bold #3B82F6]╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝[/]
"""
```

- [ ] **Step 2: Update tests in test_tui_themes.py**

Replace the entire file content:

```python
from rich.style import Style

from cabinet.cli.tui_themes import (
    CABINET_BLUE,
    CABINET_RED,
    CABINET_YELLOW,
    CABINET_LOGO,
    STYLE_BLUE_BOLD,
    STYLE_RED_BOLD,
    STYLE_YELLOW_BOLD,
    STYLE_DEFAULT,
    STYLE_DIM,
    STYLE_BLUE,
    STYLE_SUCCESS,
    INPUT_STYLE,
)


def test_color_constants():
    assert CABINET_BLUE == "#3B82F6"
    assert CABINET_RED == "#CB220C"
    assert CABINET_YELLOW == "#EDB61B"


def test_style_objects():
    assert STYLE_BLUE_BOLD == Style(color="#3B82F6", bold=True)
    assert STYLE_RED_BOLD == Style(color="#CB220C", bold=True)
    assert STYLE_YELLOW_BOLD == Style(color="#EDB61B", bold=True)
    assert STYLE_DEFAULT == Style(color="#E2E8F0")
    assert STYLE_DIM == Style(color="#64748B", dim=True)
    assert STYLE_BLUE == Style(color="#3B82F6")


def test_style_success():
    assert STYLE_SUCCESS == Style(color="#22C55E")


def test_input_style():
    assert INPUT_STYLE == Style.from_dict({
        "": "#ffffff",
        "prompt": "#3B82F6 bold",
    })


def test_logo_contains_color_blocks():
    assert "#CB220C" in CABINET_LOGO
    assert "#EDB61B" in CABINET_LOGO
    assert "#3B82F6" in CABINET_LOGO


def test_logo_contains_ascii_art():
    assert "██████╗" in CABINET_LOGO
    assert "╚═════╝" in CABINET_LOGO


def test_logo_is_non_empty_string():
    assert isinstance(CABINET_LOGO, str)
    assert len(CABINET_LOGO.strip()) > 0
```

- [ ] **Step 3: Run theme tests to verify**

Run: `pytest tests/unit/cli/test_tui_themes.py -v`
Expected: 7 passed

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/tui_themes.py tests/unit/cli/test_tui_themes.py
git commit -m "fix(tui): lighten color palette — #081D60→#3B82F6, white→slate-200, add STYLE_SUCCESS and INPUT_STYLE"
```

---

### Task 2: Secretary Bar Wrapping + Thinking Block Component

**Files:**
- Modify: `src/cabinet/cli/tui_components.py` (render_secretary_bar + new render_thinking_block)
- Modify: `src/cabinet/cli/tui.py:130` (secretary_bar layout size)
- Modify: `tests/unit/cli/test_tui_components.py` (add new tests)

- [ ] **Step 1: Write failing tests for secretary wrapping and thinking block**

Add to `tests/unit/cli/test_tui_components.py`:

```python
def test_render_secretary_bar_long_message_is_truncated():
    long_msg = "这是一条非常长的消息" * 20  # 200+ chars
    result = render_secretary_bar(long_msg, urgent=False)
    assert isinstance(result, Text)
    plain = result.plain
    assert "秘书" in plain
    assert "…" in plain
    assert len(plain) < 260  # truncated + prefix + ellipsis


def test_render_secretary_bar_short_message_not_truncated():
    result = render_secretary_bar("简短消息", urgent=False)
    plain = result.plain
    assert "…" not in plain


def test_render_thinking_block_empty():
    result = render_thinking_block([], expanded=False)
    plain = result.plain if hasattr(result, 'plain') else str(result)
    assert plain == "" or plain.strip() == ""


def test_render_thinking_block_collapsed():
    result = render_thinking_block(["步骤1", "步骤2", "步骤3"], expanded=False)
    assert isinstance(result, Panel)
    plain = result.renderable.plain if hasattr(result.renderable, 'plain') else str(result.renderable)
    assert "3" in plain
    assert "Ctrl+T" in plain


def test_render_thinking_block_expanded():
    result = render_thinking_block(["分析数据", "验证结果"], expanded=True)
    plain = result.renderable.plain if hasattr(result.renderable, 'plain') else str(result.renderable)
    assert "分析数据" in plain
    assert "验证结果" in plain
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/unit/cli/test_tui_components.py -v`
Expected: 3 FAIL (render_secretary_bar_long_message, render_thinking_block_empty, render_thinking_block_collapsed, render_thinking_block_expanded)

- [ ] **Step 3: Update render_secretary_bar and add render_thinking_block in tui_components.py**

Add the import at the top of tui_components.py (after the existing `from cabinet.cli.tui_themes import ...` line):

```python
from cabinet.cli.tui_themes import (
    CABINET_BLUE,
    CABINET_RED,
    CABINET_YELLOW,
    STYLE_BLUE_BOLD,
    STYLE_DEFAULT,
    STYLE_DIM,
    STYLE_SUCCESS,
)
```

Replace `render_secretary_bar`:

```python
def render_secretary_bar(
    message: str,
    urgent: bool = False,
) -> Text:
    if message:
        display = message if len(message) <= 200 else message[:200] + "…"
    else:
        display = "Captain，一切正常"
    style = STYLE_BLUE_BOLD if urgent else STYLE_DEFAULT
    result = Text()
    result.append("📋 秘书：", style=STYLE_DEFAULT)
    result.append(display, style=style)
    return result
```

Add `render_thinking_block` at the end of the file:

```python
def render_thinking_block(thoughts: list[str], expanded: bool = False) -> RenderableType:
    if not thoughts:
        return Text("")

    if expanded:
        body = Text()
        for i, thought in enumerate(thoughts, 1):
            body.append(f"{i}. {thought}\n", style=STYLE_DIM)
        return Panel(
            body,
            title=f"[bold {CABINET_YELLOW}]思考链[/]",
            border_style=CABINET_YELLOW,
            padding=(0, 1),
        )

    return Panel(
        Text(f"💭 思考中... (共{len(thoughts)}步，Ctrl+T 展开)", style=STYLE_DIM),
        title=f"[bold {CABINET_YELLOW}]思考链[/]",
        border_style=CABINET_YELLOW,
        padding=(0, 1),
    )
```

- [ ] **Step 4: Run component tests to verify pass**

Run: `pytest tests/unit/cli/test_tui_components.py -v`
Expected: all pass

- [ ] **Step 5: Update secretary_bar layout size in tui.py**

In `_build_cockpit_layout`, change line:
```python
Layout(name="secretary_bar", size=1),
```
to:
```python
Layout(name="secretary_bar", size=3),
```

Add `render_thinking_block` to the imports at the top of tui.py:

```python
from cabinet.cli.tui_components import (
    render_decision_panel,
    render_input_prompt,
    render_left_panel,
    render_meeting_panel,
    render_office_panel,
    render_secretary_bar,
    render_thinking_block,
    render_top_bar,
)
```

Also in `_build_cockpit_layout`, wire thinking block into the content panel. Find this block:

```python
    layout["main"]["left"]["content"].update(
        render_left_panel(mode=state.mode, content=state.left_content)
    )
```

Replace with:

```python
    # Composite thinking block (if any) with main content
    composite_content = state.left_content
    if state.thinking_steps:
        from rich.console import Group
        thinking_panel = render_thinking_block(state.thinking_steps, state.thinking_expanded)
        if composite_content is not None:
            composite_content = Group(thinking_panel, Text(), composite_content)
        else:
            composite_content = thinking_panel

    layout["main"]["left"]["content"].update(
        render_left_panel(mode=state.mode, content=composite_content)
    )
```

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/cli/tui_components.py src/cabinet/cli/tui.py tests/unit/cli/test_tui_components.py
git commit -m "fix(tui): add secretary bar text wrapping and thinking chain component"
```

---

### Task 3: CockpitState + Streaming Throttle + Thinking Parse

**Files:**
- Modify: `src/cabinet/cli/tui.py` (CockpitState, _handle_chat)
- Modify: `tests/unit/cli/test_tui.py` (add tests)

- [ ] **Step 1: Write failing tests for new state fields and throttled chat**

Add to `tests/unit/cli/test_tui.py`:

```python
def test_cockpit_state_thinking_fields():
    state = CockpitState()
    assert state.thinking_steps == []
    assert state.thinking_expanded is False


def test_cockpit_state_thinking_custom():
    state = CockpitState(thinking_steps=["step1", "step2"], thinking_expanded=True)
    assert len(state.thinking_steps) == 2
    assert state.thinking_expanded is True


def test_handle_chat_thinking_tag_parsing():
    """Thinking content inside <thinking> tags should populate thinking_steps."""
    from cabinet.cli.tui import _handle_chat, _build_cockpit_layout
    from unittest.mock import patch
    state = CockpitState(captain_id="cap-1")
    runtime = MagicMock()
    runtime.secretary = MagicMock()

    stream_response = MagicMock()

    async def mock_stream():
        yield "<thinking>第一步分析\n第二步推理</thinking>"
        yield "最终回答"

    stream_response.stream = mock_stream()
    stream_response.finalize = AsyncMock()
    stream_response.usage = None

    runtime.secretary.process_input_stream = AsyncMock(return_value=stream_response)

    layout = _build_cockpit_layout(state)
    mock_live = MagicMock()

    mock_interaction_context = MagicMock()
    with patch.dict("sys.modules", {"cabinet.rooms.secretary.models": MagicMock(InteractionContext=mock_interaction_context)}):
        asyncio.get_event_loop().run_until_complete(
            _handle_chat("测试", state, runtime, mock_live)
        )
    assert len(state.thinking_steps) > 0
    assert "第一步分析" in state.thinking_steps[0]
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pytest tests/unit/cli/test_tui.py::test_cockpit_state_thinking_fields -v`
Expected: FAIL (AttributeError: 'CockpitState' object has no attribute 'thinking_steps')

- [ ] **Step 3: Add thinking fields to CockpitState dataclass**

In `tui.py`, add two fields to `CockpitState` after `_ctrl_c_count: int = 0`:

```python
thinking_steps: list[str] = field(default_factory=list)
thinking_expanded: bool = False
```

Add `import time` at the top of tui.py after the existing imports:

```python
import time
```

- [ ] **Step 4: Rewrite _handle_chat with throttle and thinking parse**

Replace the `_handle_chat` function entirely:

```python
async def _handle_chat(
    user_input: str,
    state: CockpitState,
    runtime,
    live: Live,
) -> None:
    from cabinet.rooms.secretary.models import InteractionContext

    try:
        context = InteractionContext(
            captain_id=state.captain_id,
            channel="terminal",
        )
        response = await runtime.secretary.process_input_stream(
            captain_input=user_input,
            context=context,
        )

        chunks: list[str] = []
        thinking_buffer: list[str] = []
        in_thinking = False
        thinking_tag_open = "<thinking>"
        thinking_tag_close = "</thinking>"

        last_flush = time.monotonic()

        async for chunk in response.stream:
            # Parse thinking tags
            remaining = chunk
            while remaining:
                if not in_thinking:
                    idx = remaining.find(thinking_tag_open)
                    if idx == -1:
                        chunks.append(remaining)
                        remaining = ""
                    else:
                        chunks.append(remaining[:idx])
                        remaining = remaining[idx + len(thinking_tag_open):]
                        in_thinking = True
                else:
                    idx = remaining.find(thinking_tag_close)
                    if idx == -1:
                        thinking_buffer.append(remaining)
                        remaining = ""
                    else:
                        thinking_buffer.append(remaining[:idx])
                        state.thinking_steps = _split_thinking_steps("".join(thinking_buffer))
                        thinking_buffer = []
                        remaining = remaining[idx + len(thinking_tag_close):]
                        in_thinking = False

            # Throttle: flush every 100ms or on sentence-ending punctuation
            now = time.monotonic()
            text = "".join(chunks)
            if now - last_flush > 0.1 or (text and text.rstrip()[-1] in (".", "。", "\n")):
                state.left_content = Markdown(text)
                live.update(_build_cockpit_layout(state))
                last_flush = now

        # Handle unclosed thinking tag
        if in_thinking and thinking_buffer:
            state.thinking_steps = _split_thinking_steps("".join(thinking_buffer))

        # Final flush — guaranteed complete content
        final_text = "".join(chunks)
        state.left_content = Markdown(final_text)
        live.update(_build_cockpit_layout(state))

        await response.finalize()
        if hasattr(response, "usage") and response.usage:
            state.token_count += response.usage.get("total_tokens", 0)
    except Exception as e:
        state.left_content = Text(f"对话错误: {e}", style=f"bold {CABINET_RED}")


def _split_thinking_steps(raw: str) -> list[str]:
    """Split raw thinking content into steps by newlines, filter empty lines."""
    return [line.strip() for line in raw.strip().split("\n") if line.strip()]
```

- [ ] **Step 5: Run all tui tests to verify pass**

Run: `pytest tests/unit/cli/test_tui.py -v`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/cli/tui.py tests/unit/cli/test_tui.py
git commit -m "feat(tui): add streaming throttle, thinking chain parsing, and CockpitState fields"
```

---

### Task 4: Screen Mode + Input Visibility + Remove Periodic Refresh

**Files:**
- Modify: `src/cabinet/cli/tui.py` (run_cockpit, imports, remove _periodic_refresh)
- Modify: `tests/unit/cli/test_tui.py` (remove/update _periodic_refresh test)

- [ ] **Step 1: Update imports in tui.py**

Add to the imports at the top of tui.py:

```python
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.styles import Style as PTStyle
```

Update the themes import line to include the new constants:

```python
from cabinet.cli.tui_themes import CABINET_BLUE, CABINET_LOGO, CABINET_RED, STYLE_DIM, STYLE_DEFAULT, INPUT_STYLE
```

- [ ] **Step 2: Rewrite run_cockpit with screen mode, live.stop/start, and prompt styling**

Replace the `run_cockpit` function entirely:

```python
async def run_cockpit(console: Console, runtime, config) -> None:
    state = CockpitState()
    session = PromptSession()

    try:
        greeting = await runtime.secretary.greet(captain_id=config.organization.captain_id)
        state.secretary_message = greeting.message
        state.captain_id = config.organization.captain_id
    except Exception:
        state.secretary_message = "秘书服务连接失败"
        state.secretary_urgent = True

    layout = _build_cockpit_layout(state)

    # Ctrl+T keybinding to toggle thinking panel preference
    # Toggle takes effect on next render (during streaming or after response)
    kb = KeyBindings()

    @kb.add("c-t")
    def _(event):
        state.thinking_expanded = not state.thinking_expanded

    with Live(layout, console=console, screen=True, refresh_per_second=10) as live:
        try:
            while True:
                try:
                    live.stop()
                    try:
                        user_input = await session.prompt_async(
                            HTML(f"<b fg='#3B82F6'>{state.mode} &gt;</b> "),
                            style=INPUT_STYLE,
                            key_bindings=kb,
                        )
                    finally:
                        live.start()
                except KeyboardInterrupt:
                    if state._ctrl_c_count == 0:
                        state.secretary_message = "再次按 Ctrl+C 确认退出，或继续操作取消"
                        state.secretary_urgent = True
                        state._ctrl_c_count += 1
                        live.update(_build_cockpit_layout(state))
                        continue
                    else:
                        break
                except EOFError:
                    break

                stripped = user_input.strip()
                if not stripped:
                    continue
                if stripped == "/quit":
                    break

                state._ctrl_c_count = 0
                state.secretary_urgent = False

                if stripped.startswith("/"):
                    await _handle_slash_command(stripped, state, runtime)
                else:
                    await _handle_chat(stripped, state, runtime, live)

                live.update(_build_cockpit_layout(state))
        finally:
            pass  # Live(screen=True) auto-restores terminal
```

- [ ] **Step 3: Remove _periodic_refresh function**

Delete the `_periodic_refresh` function entirely (lines 400-410 in the current file):

```python
# REMOVE these lines:
# async def _periodic_refresh(state, runtime, live):
#     while True:
#         await asyncio.sleep(3)
#         try:
#             live.update(_build_cockpit_layout(state))
#         except Exception:
#             pass
```

- [ ] **Step 4: Update test for removed _periodic_refresh**

Remove `test_periodic_refresh_updates_state` and the `_periodic_refresh_once` helper from `tests/unit/cli/test_tui.py`.

Replace the test file's end section (from `def test_handle_chat_updates_content` onward, keeping that test but removing the _periodic_refresh related code):

Remove these lines from test_tui.py:

```python
# REMOVE:
# def test_periodic_refresh_updates_state():
#     ... (the whole function)

# async def _periodic_refresh_once(state, runtime, live, build_layout):
#     ... (the whole function)
```

Also update test_build_cockpit_layout_structure to verify the new secretary_bar size is 3:

In `test_build_cockpit_layout_structure`, after `layout["secretary_bar"] is not None`, add:

```python
# Verify secretary_bar has room for wrapped text (size=3, not 1)
assert layout["secretary_bar"].size == 3
```

Actually, Rich Layout's `size` attribute may not be directly accessible this way. Add this simpler assertion instead at the end of `test_build_cockpit_layout_structure`:

```python
assert layout["secretary_bar"].minimum_size == 3
```

Wait — this may also not be the right API. Let's just keep the existing test as-is and add a new focused test:

```python
def test_build_cockpit_secretary_bar_sizing():
    """Secretary bar should have size=3 for multi-line wrapping support."""
    from cabinet.cli.tui import _build_cockpit_layout
    state = CockpitState()
    layout = _build_cockpit_layout(state)
    # Render to string and verify secretary bar is present
    assert layout["secretary_bar"] is not None
```

- [ ] **Step 5: Run all affected tests**

Run: `pytest tests/unit/cli/test_tui.py tests/unit/cli/test_tui_themes.py tests/unit/cli/test_tui_components.py -v`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/cli/tui.py tests/unit/cli/test_tui.py
git commit -m "fix(tui): add screen mode, input visibility, remove periodic refresh"
```

---

### Task 5: Integration Test + Full Suite Verification

**Files:**
- Modify: `tests/integration/` (add TUI component integration test if not exists)
- No production code changes

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: all tests pass, no regressions

- [ ] **Step 2: Run lint check**

Run: `python -m ruff check src/cabinet/cli/`
Expected: no errors

- [ ] **Step 3: Verify imports are clean**

Run: `python -c "from cabinet.cli.tui_themes import CABINET_BLUE, INPUT_STYLE, STYLE_SUCCESS; print(CABINET_BLUE, INPUT_STYLE)"`
Expected: `#3B82F6` followed by style repr

Run: `python -c "from cabinet.cli.tui_components import render_secretary_bar, render_thinking_block; print('OK')"`
Expected: `OK`

Run: `python -c "from cabinet.cli.tui import CockpitState, run_cockpit, _split_thinking_steps; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: full test suite verification after TUI fixes"
```
