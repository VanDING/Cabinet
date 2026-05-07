# TUI Textual Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full TUI rewrite — migrate from Rich+prompt_toolkit to Textual framework, eliminating terminal rendering conflicts.

**Architecture:** Textual App with CSS styling and reactive state. Single rendering pipeline for display + input. Component-based widget tree. No more Rich Live vs prompt_toolkit competition.

**Tech Stack:** Python 3.12+, Textual >=0.86, Rich (internal use by Textual)

---

### Phase 1: Foundation

---

### Task 1: Add Textual Dependency + Create App Skeleton

**Files:**
- Modify: `pyproject.toml` (add textual dependency)
- Create: `src/cabinet/cli/app.py`

- [ ] **Step 1: Add textual to pyproject.toml**

Read `pyproject.toml`. Find the dependencies list and add `"textual>=0.86",`.

```toml
dependencies = [
    "pydantic>=2.7",
    "litellm>=1.81.1",
    ...
    "textual>=0.86",
]
```

Then install: `pip install -e .`

- [ ] **Step 2: Create the CabinetApp class**

Create `src/cabinet/cli/app.py`:

```python
from __future__ import annotations

from textual.app import App

from cabinet.cli.screens.welcome import WelcomeScreen


class CabinetApp(App):
    """Main Textual application for Cabinet TUI."""

    CSS_PATH = "cockpit.tcss"

    BINDINGS = [
        ("ctrl+c", "quit", "Quit"),
    ]

    def __init__(self, runtime, config, data_dir: str):
        super().__init__()
        self.runtime = runtime
        self.config = config
        self.data_dir = data_dir

    def on_mount(self) -> None:
        self.push_screen(WelcomeScreen(self.runtime))
```

- [ ] **Step 3: Verify import works**

Run: `python -c "from cabinet.cli.app import CabinetApp; print('OK')"`
Expected: `OK` (after pip install)

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml src/cabinet/cli/app.py
git commit -m "feat(tui): add textual dependency and CabinetApp skeleton"
```

---

### Task 2: Create State + CSS

**Files:**
- Create: `src/cabinet/cli/state.py`
- Create: `src/cabinet/cli/cockpit.tcss`

- [ ] **Step 1: Create CockpitState dataclass**

Create `src/cabinet/cli/state.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class CockpitState:
    """Reactive cockpit state for CockpitScreen."""

    mode: str = "decision"
    token_count: int = 0
    session_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    secretary_message: str = ""
    secretary_urgent: bool = False
    captain_id: str = ""
    api_connected: bool = True

    # Conversation
    conversation: list[dict] = field(default_factory=list)
    streaming_content: str = ""

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

- [ ] **Step 2: Create cockpit.tcss**

Create `src/cabinet/cli/cockpit.tcss`:

```css
Screen {
    background: #0c0c0c;
}

#header {
    height: 1;
    background: #1a1a2e;
    color: #3B82F6;
    text-style: bold;
}

#secretary-bar {
    height: 2;
    color: #E2E8F0;
}

#secretary-bar.urgent {
    color: #CB220C;
    text-style: bold;
}

#main-area {
    layout: horizontal;
}

#left-content {
    width: 80%;
}

#right-panel {
    width: 20%;
    layout: vertical;
}

#conversation-view {
    height: 1fr;
}

#thinking-panel {
    border: solid #EDB61B;
    height: auto;
    max-height: 12;
}

#meeting-panel, #decision-panel, #office-panel {
    border: solid #3B82F6;
    height: 1fr;
    padding: 0 1;
}

#input-area {
    height: 3;
}

#input-area Input {
    border: solid #3B82F6;
    color: #ffffff;
}
```

- [ ] **Step 3: Verify CSS parses correctly**

Run: `python -c "from textual.css.parse import parse; parse(open('src/cabinet/cli/cockpit.tcss').read(), 'cockpit.tcss'); print('CSS OK')"`
Expected: `CSS OK`

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/state.py src/cabinet/cli/cockpit.tcss
git commit -m "feat(tui): add CockpitState dataclass and cockpit.tcss stylesheet"
```

---

### Task 3: Create WelcomeScreen + CockpitScreen Skeleton

**Files:**
- Create: `src/cabinet/cli/screens/__init__.py`
- Create: `src/cabinet/cli/screens/welcome.py`
- Create: `src/cabinet/cli/screens/cockpit.py`
- Create: `src/cabinet/cli/widgets/__init__.py`
- Modify: `src/cabinet/cli/main.py` (wire _chat_async to launch Textual app)

- [ ] **Step 1: Create package __init__ files**

Create empty `src/cabinet/cli/screens/__init__.py` and `src/cabinet/cli/widgets/__init__.py`.

- [ ] **Step 2: Create WelcomeScreen**

Create `src/cabinet/cli/screens/welcome.py`:

```python
from __future__ import annotations

from textual.app import ComposeResult
from textual.screen import Screen
from textual.widgets import Static

from cabinet.cli.tui_themes import CABINET_LOGO


class WelcomeScreen(Screen):
    """Welcome screen with logo, press any key to enter cockpit."""

    def __init__(self, runtime):
        super().__init__()
        self._runtime = runtime

    def compose(self) -> ComposeResult:
        yield Static(CABINET_LOGO.strip(), id="logo")
        yield Static("v0.1.0 · AI Collaboration Framework", id="version")
        yield Static("Captain，欢迎登上 Cabinet", id="greeting")
        yield Static("Press any key to enter the cockpit...", id="prompt")

    def on_key(self, event) -> None:
        from cabinet.cli.screens.cockpit import CockpitScreen
        self.app.push_screen(
            CockpitScreen(self._runtime, self.app.config, self.app.data_dir)
        )
```

- [ ] **Step 3: Create CockpitScreen skeleton**

Create `src/cabinet/cli/screens/cockpit.py`:

```python
from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import Screen
from textual.widgets import Footer, Input, Static

from cabinet.cli.state import CockpitState


class CockpitScreen(Screen):
    """Main cockpit TUI screen."""

    BINDINGS = [
        ("ctrl+t", "toggle_thinking", "Toggle Thinking"),
        ("ctrl+c", "request_quit", "Quit"),
    ]

    def __init__(self, runtime, config, data_dir: str):
        super().__init__()
        self.runtime = runtime
        self.config = config
        self.data_dir = data_dir
        self.state = CockpitState()

    def compose(self) -> ComposeResult:
        yield Static("Token: 0 │ Session: 0:00:00 │ 🧭 决策室", id="header")
        yield Static("📋 秘书：Captain，一切正常", id="secretary-bar")
        with Horizontal(id="main-area"):
            with Vertical(id="left-content"):
                with VerticalScroll(id="conversation-view"):
                    yield Static("开始对话吧...", id="conversation")
            with Vertical(id="right-panel"):
                yield Static("会议室\nIdle", id="meeting-panel")
                yield Static("决策室\n暂无决策", id="decision-panel")
                yield Static("办公室\nIdle", id="office-panel")
        yield Input(placeholder="decision > ", id="input-area")

    def on_mount(self) -> None:
        self._greet()

    async def _greet(self) -> None:
        try:
            greeting = await self.runtime.secretary.greet(
                captain_id=self.config.organization.captain_id
            )
            self.state.secretary_message = greeting.message
            self.state.captain_id = self.config.organization.captain_id
            self.query_one("#secretary-bar").update(
                f"📋 秘书：{greeting.message}"
            )
        except Exception:
            self.query_one("#secretary-bar").update(
                "📋 秘书：秘书服务连接失败"
            )

    def action_toggle_thinking(self) -> None:
        self.state.thinking_expanded = not self.state.thinking_expanded

    def action_request_quit(self) -> None:
        self.app.exit()
```

- [ ] **Step 4: Wire cabinet chat entry point**

Read `src/cabinet/cli/main.py`. In `_chat_async` (line ~187), replace the current `run_welcome_screen` + `run_cockpit` calls with Textual app launch:

```python
async def _chat_async(data_dir: str) -> None:
    from cabinet.cli.app import CabinetApp

    runtime, config = await _init_runtime(data_dir)
    try:
        app = CabinetApp(runtime, config, data_dir)
        await app.run_async()
    finally:
        await runtime.stop()
```

- [ ] **Step 5: Verify basic launch works**

Run: `python -c "from cabinet.cli.screens.welcome import WelcomeScreen; from cabinet.cli.screens.cockpit import CockpitScreen; print('Imports OK')"`
Expected: `Imports OK`

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/cli/screens/ src/cabinet/cli/widgets/ src/cabinet/cli/main.py
git commit -m "feat(tui): add WelcomeScreen, CockpitScreen skeleton, wire chat entry point"
```

---

### Phase 2: Conversation + Input

---

### Task 4: Create ConversationView Widget

**Files:**
- Create: `src/cabinet/cli/widgets/conversation.py`
- Modify: `src/cabinet/cli/screens/cockpit.py` (use ConversationView)

- [ ] **Step 1: Write failing test**

Create `tests/unit/cli/test_widgets_conversation.py`:

```python
from cabinet.cli.widgets.conversation import _render_message


def test_render_user_message():
    msg = {"role": "user", "content": "Hello"}
    result = _render_user_message(msg)
    assert result is not None


def test_render_assistant_message():
    msg = {"role": "assistant", "content": "Hi there"}
    result = _render_assistant_message(msg)
    assert result is not None
```

Run: `pytest tests/unit/cli/test_widgets_conversation.py -v`
Expected: FAIL (ImportError)

- [ ] **Step 2: Create ConversationView widget**

Create `src/cabinet/cli/widgets/conversation.py`:

```python
from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import VerticalScroll
from textual.widgets import Markdown, Static


ASSISTANT_COLOR = "#E2E8F0"
USER_COLOR = "#64748B"


class ConversationView(VerticalScroll):
    """Scrollable conversation display with user messages and AI responses."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._messages: list[dict] = []

    def clear(self) -> None:
        self._messages = []
        self.remove_children()
        self.mount(Static("开始对话吧...", id="placeholder"))

    def add_user_message(self, text: str) -> None:
        self._remove_placeholder()
        self._messages.append({"role": "user", "content": text})
        self.mount(
            Static(f"💬 {text}", classes="user-message")
        )

    def add_assistant_message(self, text: str) -> None:
        self._remove_placeholder()
        self._messages.append({"role": "assistant", "content": text})
        self.mount(
            Markdown(text, classes="assistant-message")
        )

    def update_streaming(self, partial_text: str) -> None:
        """Update the in-progress assistant message during streaming."""
        pass  # handled by CockpitScreen worker

    def _remove_placeholder(self) -> None:
        placeholder = self.query_one("#placeholder")
        if placeholder:
            placeholder.remove()

    @property
    def messages(self) -> list[dict]:
        return list(self._messages)


def _render_user_message(msg: dict) -> Static:
    return Static(f"💬 {msg['content']}")


def _render_assistant_message(msg: dict) -> Markdown:
    return Markdown(msg["content"])
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/unit/cli/test_widgets_conversation.py -v`
Expected: 2 passed

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/widgets/conversation.py tests/unit/cli/test_widgets_conversation.py
git commit -m "feat(tui): add ConversationView widget for chat display"
```

---

### Task 5: Create InputArea with Completion + History

**Files:**
- Create: `src/cabinet/cli/widgets/input_area.py`
- Modify: `src/cabinet/cli/screens/cockpit.py` (integrate InputArea)

- [ ] **Step 1: Write failing test**

Create `tests/unit/cli/test_widgets_input_area.py`:

```python
from cabinet.cli.widgets.input_area import _filter_completions, SLASH_COMMANDS_LIST


def test_slash_commands_list():
    assert "/decision" in SLASH_COMMANDS_LIST
    assert "/meeting" in SLASH_COMMANDS_LIST
    assert "/help" in SLASH_COMMANDS_LIST
    assert len(SLASH_COMMANDS_LIST) >= 10


def test_filter_completions_slash():
    result = _filter_completions("/dec")
    assert "/decision" in result
    assert "/decide" in result


def test_filter_completions_plain_text():
    result = _filter_completions("hello")
    assert len(result) == 0
```

Run: `pytest tests/unit/cli/test_widgets_input_area.py -v`
Expected: FAIL

- [ ] **Step 2: Create InputArea widget**

Create `src/cabinet/cli/widgets/input_area.py`:

```python
from __future__ import annotations

from pathlib import Path

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Input, ListView, ListItem


SLASH_COMMANDS_LIST = [
    "/decision", "/meeting", "/office", "/summary",
    "/decide", "/task", "/strategy", "/review",
    "/skills", "/employees", "/status", "/help", "/quit",
]

SLASH_COMMAND_DESCRIPTIONS = {
    "/decision": "切换决策室",
    "/meeting": "切换会议室 / 启动审议",
    "/office": "切换办公室",
    "/summary": "切换总结室",
    "/decide": "提交决策请求",
    "/task": "提交执行任务",
    "/strategy": "解码战略提案",
    "/review": "启动复盘",
    "/skills": "列出可用技能",
    "/employees": "列出注册员工",
    "/status": "显示待处理摘要",
    "/help": "显示帮助",
    "/quit": "退出",
}


def _filter_completions(text: str) -> list[str]:
    if not text.startswith("/"):
        return []
    return [cmd for cmd in SLASH_COMMANDS_LIST if cmd.startswith(text)]


class InputArea(Vertical):
    """Input area with command completion overlay."""

    def __init__(self, data_dir: str):
        super().__init__()
        self._data_dir = data_dir
        self._history: list[str] = []
        self._history_index: int = -1
        self._load_history()

    def compose(self) -> ComposeResult:
        yield Input(placeholder="decision > ", id="prompt-input")

    def on_input_changed(self, event: Input.Changed) -> None:
        value = event.value or ""
        if value.startswith("/"):
            matches = _filter_completions(value)
            if matches:
                self._show_completions(matches)
                return
        self._hide_completions()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.value and event.value.strip():
            self._add_to_history(event.value.strip())

    def _show_completions(self, matches: list[str]) -> None:
        pass  # Phase 2+ enhancement: popup completion list

    def _hide_completions(self) -> None:
        pass

    def _add_to_history(self, text: str) -> None:
        if not self._history or self._history[-1] != text:
            self._history.append(text)
        self._history_index = -1
        self._save_history()

    def _save_history(self) -> None:
        try:
            history_path = Path(self._data_dir) / ".chat_history"
            history_path.parent.mkdir(parents=True, exist_ok=True)
            with open(history_path, "w", encoding="utf-8") as f:
                for line in self._history[-1000:]:
                    f.write(line + "\n")
        except Exception:
            pass

    def _load_history(self) -> None:
        try:
            history_path = Path(self._data_dir) / ".chat_history"
            if history_path.exists():
                with open(history_path, encoding="utf-8") as f:
                    self._history = [line.rstrip("\n") for line in f if line.strip()]
        except Exception:
            self._history = []
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/unit/cli/test_widgets_input_area.py -v`
Expected: 3 passed

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/widgets/input_area.py tests/unit/cli/test_widgets_input_area.py
git commit -m "feat(tui): add InputArea widget with command completion and history"
```

---

### Task 6: Wire Streaming Chat + Intent Detection

**Files:**
- Create: `src/cabinet/cli/intent.py` (extracted from tui.py)
- Modify: `src/cabinet/cli/screens/cockpit.py` (integrate input + chat + intent)

- [ ] **Step 1: Extract intent detection module**

Create `src/cabinet/cli/intent.py`:

```python
from __future__ import annotations

import re


def detect_intent(user_input: str) -> dict | None:
    """Detect user intent from natural language input.

    Returns intent dict with action type and params, or None for normal chat.
    """
    text = user_input.strip()

    meeting_patterns = [
        r"^开个?会?(讨论|聊聊|商量|研讨)一下(.+)",
        r"^开个?会?(讨论|聊聊|商量|研讨)(.+)",
        r"^(讨论|聊聊|商量|研讨)一下(.+)",
        r"^(讨论|聊聊|商量|研讨)(.+)",
        r"^开个?会\s*(.+)",
    ]
    for pattern in meeting_patterns:
        m = re.match(pattern, text)
        if m:
            topic = m.group(m.lastindex or 1).strip()
            return {"type": "meeting", "topic": topic,
                    "action_text": f"已为您在会议室创建审议「{topic}」"}

    task_patterns = [
        r"^(提醒我|别忘了|待办|帮我记一下)\s*(.+)",
    ]
    for pattern in task_patterns:
        m = re.match(pattern, text)
        if m:
            desc = m.group(2).strip()
            return {"type": "office", "description": desc,
                    "action_text": f"已为您添加待办「{desc}」"}

    decision_patterns = [
        r"^(决策|决定|是否应该|要不要|该不该)\s*(.+)",
    ]
    for pattern in decision_patterns:
        m = re.match(pattern, text)
        if m:
            title = m.group(2).strip()
            return {"type": "decision", "title": title,
                    "action_text": f"已为您提交决策请求「{title}」"}

    return None


async def execute_intent(intent: dict, state, runtime) -> str | None:
    """Execute detected intent against real room services. Returns feedback."""
    from uuid import uuid4
    from cabinet.rooms.meeting.models import MeetingLevel
    from cabinet.models.events import DecisionRequest, TaskOrder
    from cabinet.models.decisions import DecisionType

    try:
        if intent["type"] == "meeting":
            result = await runtime.meeting.start_session(
                topic=intent["topic"],
                level=MeetingLevel.MULTI_PARTY,
                participants=[uuid4()],
                project_id=None,
            )
            state.mode = "meeting"
            state.meeting_topic = intent["topic"]
            return intent["action_text"]

        elif intent["type"] == "office":
            order = TaskOrder(
                employee_id=uuid4(),
                skill_id=uuid4(),
                inputs={"description": intent["description"]},
            )
            await runtime.office.submit_task(order)
            state.mode = "office"
            state.office_workflow = intent["description"]
            return intent["action_text"]

        elif intent["type"] == "decision":
            request = DecisionRequest(
                decision_id=uuid4(),
                decision_type=DecisionType.STRATEGIC.value,
                title=intent["title"],
                options=[{"label": "Approve"}, {"label": "Reject"}],
            )
            await runtime.decision.submit(request)
            state.mode = "decision"
            return intent["action_text"]
    except Exception as e:
        return f"操作执行失败: {e}"

    return None
```

- [ ] **Step 2: Add intent tests**

Create `tests/unit/cli/test_intent.py`:

```python
from cabinet.cli.intent import detect_intent


def test_detect_intent_meeting():
    result = detect_intent("开个会讨论一下Q3预算")
    assert result is not None
    assert result["type"] == "meeting"
    assert "Q3预算" in result["topic"]


def test_detect_intent_meeting_short():
    result = detect_intent("聊聊新产品规划")
    assert result is not None
    assert result["type"] == "meeting"


def test_detect_intent_task():
    result = detect_intent("提醒我下午3点review代码")
    assert result is not None
    assert result["type"] == "office"


def test_detect_intent_decision():
    result = detect_intent("是否应该延长项目周期")
    assert result is not None
    assert result["type"] == "decision"


def test_detect_intent_no_match():
    result = detect_intent("帮我分析这个数据")
    assert result is None
```

Run: `pytest tests/unit/cli/test_intent.py -v`
Expected: 5 passed

- [ ] **Step 3: Integrate chat worker into CockpitScreen**

Update `src/cabinet/cli/screens/cockpit.py` — add streaming chat and intent handling to the `on_input_submitted` handler:

```python
from cabinet.cli.intent import detect_intent, execute_intent
from cabinet.cli.widgets.conversation import ConversationView


# In CockpitScreen class, add:

def on_input_submitted(self, event: Input.Submitted) -> None:
    """Handle user input: intent detection or chat."""
    value = event.value.strip() if event.value else ""
    if not value:
        return
    if value == "/quit":
        self.app.exit()
        return

    # Add to conversation and clear input
    self.query_one("#conversation-view", ConversationView).add_user_message(value)
    event.input.clear()

    if value.startswith("/"):
        self._handle_slash_command(value)
    else:
        intent = detect_intent(value)
        if intent:
            self.run_worker(self._execute_and_respond(intent, value))
        else:
            self.run_worker(self._stream_chat(value), exclusive=True)

async def _execute_and_respond(self, intent: dict, user_input: str) -> None:
    feedback = await execute_intent(intent, self.state, self.runtime)
    if feedback:
        self.state.secretary_message = feedback
        self.query_one("#secretary-bar").update(f"📋 秘书：{feedback}")
        self.query_one("#conversation-view", ConversationView).add_assistant_message(
            f"📋 {feedback}"
        )

async def _stream_chat(self, user_input: str) -> None:
    from cabinet.rooms.secretary.models import InteractionContext

    conversation = self.query_one("#conversation-view", ConversationView)
    recent = self.state.conversation[-10:]
    recent_interactions = [
        f"[{m['role']}]: {m['content'][:200]}" for m in recent[:-1]
    ]

    context = InteractionContext(
        captain_id=self.state.captain_id,
        channel="terminal",
        recent_interactions=recent_interactions,
    )

    try:
        response = await self.runtime.secretary.process_input_stream(
            captain_input=user_input,
            context=context,
        )
        chunks: list[str] = []
        async for chunk in response.stream:
            chunks.append(chunk)
            # Throttle updates via Textual's built-in render cycle

        final_text = "".join(chunks)
        self.state.conversation.append({"role": "assistant", "content": final_text})
        conversation.add_assistant_message(final_text)

        await response.finalize()
        if hasattr(response, "usage") and response.usage:
            self.state.token_count += response.usage.get("total_tokens", 0)

    except Exception as e:
        self.state.conversation.append({
            "role": "assistant", "content": f"对话错误: {e}"
        })
        conversation.add_assistant_message(f"对话错误: {e}")

def _handle_slash_command(self, text: str) -> None:
    """Handle slash commands (mode switches, status, help)."""
    cmd = text.split()[0]
    if cmd in ("/decision", "/meeting", "/office", "/summary"):
        self.state.mode = cmd.lstrip("/")
        mode_names = {
            "decision": "决策室", "meeting": "会议室",
            "office": "办公室", "summary": "总结室",
        }
        name = mode_names.get(self.state.mode, self.state.mode)
        self.query_one("#header").update(
            f"Token: {self.state.token_count} │ 🧭 {name}"
        )
        self.query_one("#secretary-bar").update(f"📋 秘书：已切换至{name}")
    elif cmd == "/status":
        self._handle_status()
    elif cmd == "/help":
        self._show_help()
    else:
        self.query_one("#secretary-bar").update(
            f"📋 秘书：未知命令: {cmd}，输入 /help 查看帮助"
        )

async def _handle_status(self) -> None:
    try:
        result = await self.runtime.secretary.summarize_pending(
            captain_id=self.state.captain_id
        )
        self.state.secretary_message = result.digest
        self.state.secretary_urgent = result.urgent_count > 0
        self.query_one("#secretary-bar").update(
            f"📋 秘书：{result.digest}"
        )
    except Exception as e:
        self.query_one("#secretary-bar").update(f"📋 秘书：获取状态失败: {e}")

def _show_help(self) -> None:
    conversation = self.query_one("#conversation-view", ConversationView)
    help_text = """**可用命令:**
- /decision — 切换决策室
- /meeting — 切换会议室
- /office — 切换办公室
- /summary — 切换总结室
- /decide <title> — 提交决策
- /task <desc> — 提交任务
- /strategy <proposal> — 解码战略
- /review — 启动复盘
- /skills — 列出技能
- /employees — 列出员工
- /status — 待处理摘要
- /help — 显示帮助
- /quit — 退出"""
    conversation.add_assistant_message(help_text)
```

- [ ] **Step 4: Run all new tests**

Run: `pytest tests/unit/cli/test_intent.py tests/unit/cli/test_widgets_input_area.py tests/unit/cli/test_widgets_conversation.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/intent.py src/cabinet/cli/screens/cockpit.py tests/unit/cli/test_intent.py
git commit -m "feat(tui): add streaming chat worker, intent detection, and slash commands to CockpitScreen"
```

---

### Phase 3: Panels + Polish

---

### Task 7: Create Side Panel Widgets

**Files:**
- Create: `src/cabinet/cli/widgets/side_panels.py`
- Modify: `src/cabinet/cli/screens/cockpit.py` (integrate panels)

- [ ] **Step 1: Create side panel widgets**

Create `src/cabinet/cli/widgets/side_panels.py`:

```python
from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Static, ProgressBar

from cabinet.cli.state import CockpitState


class MeetingPanel(Vertical):
    """Meeting room status panel."""

    def compose(self) -> ComposeResult:
        yield Static("会议室", classes="panel-title")
        yield Static("Idle", id="meeting-content")

    def update_state(self, state: CockpitState) -> None:
        if state.meeting_topic:
            self.query_one("#meeting-content").update(
                f"议题: {state.meeting_topic}\n"
                f"顾问: {state.meeting_advisors} · 轮次: {state.meeting_round}"
            )
        else:
            self.query_one("#meeting-content").update("Idle")


class DecisionPanel(Vertical):
    """Decision room status panel."""

    def compose(self) -> ComposeResult:
        yield Static("决策室", classes="panel-title")
        yield Static("暂无决策", id="decision-content")

    def update_state(self, state: CockpitState) -> None:
        r, y, b = state.decision_red, state.decision_yellow, state.decision_blue
        if r == y == b == 0:
            self.query_one("#decision-content").update("暂无决策")
        else:
            self.query_one("#decision-content").update(
                f"🔴 战略: {r}  🟡 战术: {y}  🔵 执行: {b}"
            )


class OfficePanel(Vertical):
    """Office room status panel."""

    def __init__(self):
        super().__init__()
        self._progress = ProgressBar(total=100)

    def compose(self) -> ComposeResult:
        yield Static("办公室", classes="panel-title")
        yield self._progress
        yield Static("Idle", id="office-content")

    def update_state(self, state: CockpitState) -> None:
        if state.office_workflow:
            self._progress.update(progress=int(state.office_progress * 100))
            self.query_one("#office-content").update(
                f"{state.office_workflow}\n当前: {state.office_current_node}"
            )
        else:
            self._progress.update(progress=0)
            self.query_one("#office-content").update("Idle")
```

- [ ] **Step 2: Integrate panels into CockpitScreen**

In `CockpitScreen.compose()`, replace the static sidebar with widget instances:

```python
with Vertical(id="right-panel"):
    yield MeetingPanel(id="meeting-panel")
    yield DecisionPanel(id="decision-panel")
    yield OfficePanel(id="office-panel")
```

Add a method to sync panels from state:

```python
def _sync_panels(self) -> None:
    self.query_one("#meeting-panel", MeetingPanel).update_state(self.state)
    self.query_one("#decision-panel", DecisionPanel).update_state(self.state)
    self.query_one("#office-panel", OfficePanel).update_state(self.state)
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `pytest tests/unit/cli/ -v`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/widgets/side_panels.py src/cabinet/cli/screens/cockpit.py
git commit -m "feat(tui): add side panel widgets (Meeting, Decision, Office) with live state"
```

---

### Task 8: Create ThinkingPanel + Header Widget

**Files:**
- Create: `src/cabinet/cli/widgets/thinking.py`
- Create: `src/cabinet/cli/widgets/header.py`
- Modify: `src/cabinet/cli/screens/cockpit.py` (integrate thinking + header)

- [ ] **Step 1: Create Header widget**

Create `src/cabinet/cli/widgets/header.py`:

```python
from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import Static


class Header(Static):
    """Top bar showing token count, session time, and current mode."""

    MODE_LABELS = {
        "decision": "🧭 决策室 (Decision)",
        "meeting": "🗣️ 会议室 (Meeting)",
        "office": "📋 办公室 (Office)",
        "summary": "📊 总结室 (Summary)",
    }

    def compose(self) -> ComposeResult:
        yield Static("Token: 0 │ Session: 0:00:00 │ 🧭 决策室", id="header-text")

    def update_info(self, token_count: int, elapsed: str, mode: str) -> None:
        mode_label = self.MODE_LABELS.get(mode, mode)
        self.query_one("#header-text").update(
            f"Token: {token_count} │ Session: {elapsed} │ {mode_label}"
        )
```

- [ ] **Step 2: Create ThinkingPanel widget**

Create `src/cabinet/cli/widgets/thinking.py`:

```python
from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Static


class ThinkingPanel(Vertical):
    """Collapsible thinking chain display."""

    def compose(self) -> ComposeResult:
        yield Static("", id="thinking-header")
        yield Static("", id="thinking-steps")

    def update_state(self, steps: list[str], expanded: bool) -> None:
        self.display = bool(steps)
        if not steps:
            return
        if expanded:
            header = f"💭 思考链 (共{len(steps)}步，Ctrl+T 折叠)"
            body = "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))
        else:
            header = f"💭 思考中... (共{len(steps)}步，Ctrl+T 展开)"
            body = ""
        self.query_one("#thinking-header").update(header)
        self.query_one("#thinking-steps").update(body)
```

- [ ] **Step 3: Integrate into CockpitScreen**

In `CockpitScreen.compose()`, replace the static header with widget instances, add Header and ThinkingPanel between secretary bar and conversation:

```python
yield Header(id="header")
yield Static("📋 秘书：Captain，一切正常", id="secretary-bar")
with Horizontal(id="main-area"):
    with Vertical(id="left-content"):
        yield ThinkingPanel(id="thinking-panel")
        with VerticalScroll(id="conversation-view"):
            yield Static("开始对话吧...", id="conversation")
    with Vertical(id="right-panel"):
        ...
```

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/widgets/header.py src/cabinet/cli/widgets/thinking.py src/cabinet/cli/screens/cockpit.py
git commit -m "feat(tui): add Header and ThinkingPanel widgets with collapsible state"
```

---

### Phase 4: Cleanup + Integration

---

### Task 9: Remove Old Code + Update Tests

**Files:**
- Deprecate: `src/cabinet/cli/tui.py` (all functions replaced by Textual widgets)
- Simplify: `src/cabinet/cli/tui_components.py` (keep only non-TUI helpers)
- Remove: `src/cabinet/cli/tui_themes.py` constants used only by old TUI
- Modify: `tests/unit/cli/test_tui.py` (update imports)
- Modify: `tests/unit/cli/test_tui_components.py` (update imports)

- [ ] **Step 1: Deprecate tui.py**

Replace the content of `src/cabinet/cli/tui.py` with a deprecation shim:

```python
"""DEPRECATED: TUI functions have been migrated to Textual widgets.

See:
- src/cabinet/cli/app.py          for CabinetApp
- src/cabinet/cli/screens/cockpit.py for CockpitScreen
- src/cabinet/cli/state.py        for CockpitState
- src/cabinet/cli/intent.py       for intent detection
"""

# Re-export CockpitState for backward compat
from cabinet.cli.state import CockpitState

# Keep intent/thinking helpers accessible
from cabinet.cli.intent import detect_intent as _detect_intent
from cabinet.cli.intent import execute_intent as _execute_intent
```

- [ ] **Step 2: Update test imports**

In `tests/unit/cli/test_tui.py`, update imports that reference old tui.py functions:

```python
# Before:
from cabinet.cli.tui import CockpitState, _handle_slash_command, ...

# After:
from cabinet.cli.tui import CockpitState
from cabinet.cli.intent import detect_intent, execute_intent
```

Remove tests for deleted functions (`_handle_slash_command`, `_handle_chat`, `_build_cockpit_layout`, `run_cockpit`, `_periodic_refresh`).

Keep tests for: `CockpitState`, `detect_intent`, `SLASH_COMMANDS`, `_split_thinking_steps`.

- [ ] **Step 3: Run all tests**

Run: `pytest tests/unit/cli/ -v`
Expected: remaining tests pass; deleted function tests removed.

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/tui.py src/cabinet/cli/tui_components.py tests/unit/cli/
git commit -m "refactor(tui): deprecate old Rich TUI code, update test imports"
```

---

### Task 10: Full Integration Verification

**Files:**
- No production code changes

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -q --tb=line`
Expected: all pass, zero regressions

- [ ] **Step 2: Run lint**

Run: `python -m ruff check src/cabinet/cli/ tests/unit/cli/`
Expected: no errors

- [ ] **Step 3: Verify imports**

Run each:
```bash
python -c "from cabinet.cli.app import CabinetApp; print('OK')"
python -c "from cabinet.cli.screens.welcome import WelcomeScreen; print('OK')"
python -c "from cabinet.cli.screens.cockpit import CockpitScreen; print('OK')"
python -c "from cabinet.cli.state import CockpitState; print('OK')"
python -c "from cabinet.cli.intent import detect_intent, execute_intent; print('OK')"
python -c "from cabinet.cli.widgets.conversation import ConversationView; print('OK')"
python -c "from cabinet.cli.widgets.input_area import InputArea; print('OK')"
python -c "from cabinet.cli.widgets.side_panels import MeetingPanel, DecisionPanel, OfficePanel; print('OK')"
python -c "from cabinet.cli.widgets.header import Header; print('OK')"
python -c "from cabinet.cli.widgets.thinking import ThinkingPanel; print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: full integration verification after TUI Textual migration"
```

---

### File Structure After Migration

```
src/cabinet/cli/
├── main.py              # Typer entry (unchanged)
├── app.py               # CabinetApp(Textual App)          [NEW]
├── state.py             # CockpitState dataclass            [NEW]
├── intent.py            # Intent detection                  [NEW]
├── cockpit.tcss         # CSS styles                       [NEW]
├── config.py            # CabinetConfig (unchanged)
├── providers.py         # LLM providers (unchanged)
├── commands/            # 11 command modules (unchanged)
├── screens/
│   ├── welcome.py       # WelcomeScreen                    [NEW]
│   └── cockpit.py       # CockpitScreen                    [NEW]
├── widgets/
│   ├── header.py        # Header widget                    [NEW]
│   ├── conversation.py  # ConversationView                 [NEW]
│   ├── thinking.py      # ThinkingPanel                    [NEW]
│   ├── side_panels.py   # Meeting/Decision/Office panels   [NEW]
│   └── input_area.py    # InputArea + completion           [NEW]
├── tui.py               # DEPRECATED shim [was 522 lines]
├── tui_components.py    # SIMPLIFIED
└── tui_themes.py        # SIMPLIFIED (colors in CSS)
```

**Summary**: 1 file deprecated (tui.py → 10-line shim), 9 files created, 3 files simplified. ~700 lines new code replacing ~500 lines complex Rich/Live management.
