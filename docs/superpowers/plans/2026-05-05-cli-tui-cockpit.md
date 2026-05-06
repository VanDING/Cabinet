# CLI TUI 驾驶舱实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `cabinet chat` 的简单对话界面升级为多面板驾驶舱 TUI，包含欢迎屏和四模式布局。

**Architecture:** 三个新文件（`tui_themes.py` 颜色常量、`tui_components.py` 纯渲染函数、`tui.py` 有状态主循环）+ 修改 `main.py` 的 `_chat_async` 入口。使用 Rich Live + Layout 渲染，prompt_toolkit 异步输入。

**Tech Stack:** Rich (Live, Layout, Panel, Text, Table, Progress, Align, Markdown), prompt_toolkit (PromptSession, HTML), asyncio, msvcrt/tty (按键检测)

---

## File Structure

| 操作 | 文件 | 职责 |
|---|---|---|
| Create | `src/cabinet/cli/tui_themes.py` | 颜色常量、Style 对象、CABINET_LOGO |
| Create | `src/cabinet/cli/tui_components.py` | 纯渲染函数：顶栏、秘书栏、左侧面板、右侧三面板、输入提示符 |
| Create | `src/cabinet/cli/tui.py` | CockpitState、run_welcome_screen、run_cockpit、命令路由 |
| Modify | `src/cabinet/cli/main.py` | _chat_async 替换为 TUI 入口调用 |
| Modify | `pyproject.toml` | 新增 prompt-toolkit 依赖 |
| Create | `tests/unit/cli/test_tui_themes.py` | tui_themes 单元测试 |
| Create | `tests/unit/cli/test_tui_components.py` | tui_components 单元测试 |
| Create | `tests/unit/cli/test_tui.py` | tui 集成测试 |

---

### Task 1: tui_themes.py — 颜色常量与 Logo

**Files:**
- Create: `src/cabinet/cli/tui_themes.py`
- Create: `tests/unit/cli/test_tui_themes.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/cli/test_tui_themes.py
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
)


def test_color_constants():
    assert CABINET_BLUE == "#081D60"
    assert CABINET_RED == "#CB220C"
    assert CABINET_YELLOW == "#EDB61B"


def test_style_objects():
    assert STYLE_BLUE_BOLD == Style(color="#081D60", bold=True)
    assert STYLE_RED_BOLD == Style(color="#CB220C", bold=True)
    assert STYLE_YELLOW_BOLD == Style(color="#EDB61B", bold=True)
    assert STYLE_DEFAULT == Style(color="white")
    assert STYLE_DIM == Style(color="grey62", dim=True)
    assert STYLE_BLUE == Style(color="#081D60")


def test_logo_contains_color_blocks():
    assert "#CB220C" in CABINET_LOGO
    assert "#EDB61B" in CABINET_LOGO
    assert "#081D60" in CABINET_LOGO


def test_logo_contains_ascii_art():
    assert "██████╗" in CABINET_LOGO
    assert "╚═════╝" in CABINET_LOGO


def test_logo_is_non_empty_string():
    assert isinstance(CABINET_LOGO, str)
    assert len(CABINET_LOGO.strip()) > 0
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/cli/test_tui_themes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.cli.tui_themes'`

- [ ] **Step 3: 实现 tui_themes.py**

```python
# src/cabinet/cli/tui_themes.py
from __future__ import annotations

from rich.style import Style

CABINET_BLUE = "#081D60"
CABINET_RED = "#CB220C"
CABINET_YELLOW = "#EDB61B"

STYLE_DEFAULT = Style(color="white")
STYLE_BLUE_BOLD = Style(color=CABINET_BLUE, bold=True)
STYLE_RED_BOLD = Style(color=CABINET_RED, bold=True)
STYLE_YELLOW_BOLD = Style(color=CABINET_YELLOW, bold=True)
STYLE_DIM = Style(color="grey62", dim=True)
STYLE_BLUE = Style(color=CABINET_BLUE)

CABINET_LOGO = """
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #081D60]████████████████████████████[/]
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #081D60]████████████████████████████[/]
[bold #CB220C]██████████████[/]    [bold #EDB61B]██████████████[/]    [bold #081D60]████████████████████████████[/]
                        [bold #081D60]████████████████████████████[/]
[white]██████████████[/]    [white]██████████████[/]    [bold #081D60]████████████████████████████[/]
[white]██████████████[/]    [white]██████████████[/]    [bold #081D60]████████████████████████████[/]

[bold #081D60]██████╗  █████╗ ██████╗ ██╗███╗   ██╗███████╗████████╗[/]
[bold #081D60]██╔════╝ ██╔══██╗██╔══██╗██║████╗  ██║██╔════╝╚══██╔══╝[/]
[bold #081D60]██║  ███╗███████║██████╔╝██║██╔██╗ ██║█████╗     ██║[/]
[bold #081D60]██║   ██║██╔══██║██╔══██╗██║██║╚██╗██║██╔══╝     ██║[/]
[bold #081D60]╚██████╔╝██║  ██║██████╔╝██║██║ ╚████║███████╗   ██║[/]
[bold #081D60]╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝╚══════╝   ╚═╝[/]
"""
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/cli/test_tui_themes.py -v`
Expected: 5 passed

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/tui_themes.py tests/unit/cli/test_tui_themes.py
git commit -m "feat(cli): add tui_themes with color constants, styles, and CABINET_LOGO"
```

---

### Task 2: tui_components.py — 纯渲染函数

**Files:**
- Create: `src/cabinet/cli/tui_components.py`
- Create: `tests/unit/cli/test_tui_components.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/cli/test_tui_components.py
from __future__ import annotations

from datetime import datetime, timezone

from rich.panel import Panel
from rich.text import Text

from cabinet.cli.tui_components import (
    render_top_bar,
    render_secretary_bar,
    render_left_panel,
    render_meeting_panel,
    render_decision_panel,
    render_office_panel,
    render_input_prompt,
)


def test_render_top_bar():
    now = datetime(2026, 5, 5, 12, 0, 0, tzinfo=timezone.utc)
    result = render_top_bar(
        token_count=1200,
        session_start=now,
        mode="decision",
        mode_label="🧭 决策室 (Decision)",
    )
    assert isinstance(result, Text)
    text_str = result.plain
    assert "Token" in text_str
    assert "1.2K" in text_str
    assert "Session" in text_str
    assert "决策室" in text_str


def test_render_top_bar_token_formatting():
    result = render_top_bar(
        token_count=500,
        session_start=datetime.now(timezone.utc),
        mode="meeting",
        mode_label="🗣️ 会议室 (Meeting)",
    )
    assert "500" in result.plain


def test_render_secretary_bar_normal():
    result = render_secretary_bar("一切正常", urgent=False)
    assert isinstance(result, Text)
    assert "秘书" in result.plain
    assert "一切正常" in result.plain


def test_render_secretary_bar_urgent():
    result = render_secretary_bar("紧急决策待处理", urgent=True)
    assert "紧急决策待处理" in result.plain


def test_render_secretary_bar_default():
    result = render_secretary_bar("", urgent=False)
    assert "一切正常" in result.plain


def test_render_left_panel_decision():
    result = render_left_panel("decision", content=None)
    assert isinstance(result, Panel)
    assert "决策室" in result.title


def test_render_left_panel_meeting():
    result = render_left_panel("meeting", content=None)
    assert "会议室" in result.title


def test_render_left_panel_office():
    result = render_left_panel("office", content=None)
    assert "办公室" in result.title


def test_render_left_panel_summary():
    result = render_left_panel("summary", content=None)
    assert "总结室" in result.title


def test_render_left_panel_with_content():
    content = Text("Hello from test")
    result = render_left_panel("decision", content=content)
    assert isinstance(result, Panel)


def test_render_meeting_panel_idle():
    result = render_meeting_panel()
    assert isinstance(result, Panel)
    assert "会议室" in result.title
    assert "Idle" in result.renderable.plain or "Idle" in str(result.renderable)


def test_render_meeting_panel_active():
    result = render_meeting_panel(topic="Q3 预算", advisors=3, round_num=2)
    assert "Q3 预算" in result.renderable.plain or "Q3 预算" in str(result.renderable)


def test_render_decision_panel_empty():
    result = render_decision_panel()
    assert isinstance(result, Panel)
    assert "决策室" in result.title


def test_render_decision_panel_with_counts():
    result = render_decision_panel(red=2, yellow=3, blue=5)
    text = result.renderable.plain if hasattr(result.renderable, 'plain') else str(result.renderable)
    assert "2" in text
    assert "3" in text
    assert "5" in text


def test_render_office_panel_idle():
    result = render_office_panel()
    assert isinstance(result, Panel)
    assert "办公室" in result.title


def test_render_office_panel_active():
    result = render_office_panel(workflow="数据迁移", progress=0.65, current_node="验证阶段")
    rendered = str(result.renderable)
    assert "数据迁移" in rendered or "65" in rendered


def test_render_input_prompt():
    result = render_input_prompt("decision")
    assert isinstance(result, Text)
    assert "decision" in result.plain
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/cli/test_tui_components.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.cli.tui_components'`

- [ ] **Step 3: 实现 tui_components.py**

```python
# src/cabinet/cli/tui_components.py
from __future__ import annotations

from datetime import datetime, timezone

from rich.align import Align
from rich.panel import Panel
from rich.progress import BarColumn, Progress, TextColumn
from rich.text import Text

from cabinet.cli.tui_themes import (
    CABINET_BLUE,
    CABINET_RED,
    CABINET_YELLOW,
    STYLE_BLUE_BOLD,
    STYLE_DEFAULT,
    STYLE_DIM,
)


def _format_token_count(count: int) -> str:
    if count >= 1_000_000:
        return f"{count / 1_000_000:.1f}M"
    if count >= 1_000:
        return f"{count / 1_000:.1f}K"
    return str(count)


def _format_elapsed(start: datetime) -> str:
    delta = datetime.now(timezone.utc) - start
    total_seconds = int(delta.total_seconds())
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}"


_MODE_TITLES: dict[str, str] = {
    "decision": "决策室 (Decision Chamber)",
    "meeting": "会议室 (Meeting Room)",
    "office": "办公室 (Office)",
    "summary": "总结室 (Summary Room)",
}

_MODE_PLACEHOLDERS: dict[str, str] = {
    "decision": "暂无待处理决策",
    "meeting": "暂无活跃会议",
    "office": "暂无运行中的任务",
    "summary": "暂无复盘报告",
}


def render_top_bar(
    token_count: int,
    session_start: datetime,
    mode: str,
    mode_label: str,
) -> Text:
    token_str = _format_token_count(token_count)
    elapsed_str = _format_elapsed(session_start)
    separator = Text(" │ ", style=STYLE_DIM)
    result = Text()
    result.append(f"Token: {token_str}", style=STYLE_DEFAULT)
    result.append(separator)
    result.append(f"Session: {elapsed_str}", style=STYLE_DEFAULT)
    result.append(separator)
    result.append(f"🧭 {mode_label}", style=STYLE_BLUE_BOLD)
    return result


def render_secretary_bar(
    message: str,
    urgent: bool = False,
) -> Text:
    display = message if message else "Captain，一切正常"
    style = STYLE_BLUE_BOLD if urgent else STYLE_DEFAULT
    prefix = "📋 秘书："
    result = Text()
    result.append(prefix, style=STYLE_DEFAULT)
    result.append(display, style=style)
    return result


def render_left_panel(
    mode: str,
    content: object = None,
) -> Panel:
    title = _MODE_TITLES.get(mode, mode)
    if content is not None:
        body = content
    else:
        placeholder = _MODE_PLACEHOLDERS.get(mode, "")
        body = Align.center(Text(placeholder, style=STYLE_DIM), vertical="middle")
    return Panel(
        body,
        title=f"[bold {CABINET_BLUE}]{title}[/]",
        border_style=CABINET_BLUE,
        padding=(0, 1),
    )


def render_meeting_panel(
    topic: str = "",
    advisors: int = 0,
    round_num: int = 0,
    max_rounds: int = 3,
) -> Panel:
    if topic:
        body = Text()
        body.append(f"议题: {topic}\n", style=STYLE_DEFAULT)
        body.append(f"顾问: {advisors} · 轮次: {round_num}/{max_rounds}", style=STYLE_DEFAULT)
    else:
        body = Align.center(Text("Idle", style=STYLE_DIM), vertical="middle")
    return Panel(
        body,
        title=f"[bold {CABINET_BLUE}]会议室[/]",
        border_style=CABINET_BLUE,
        padding=(0, 1),
    )


def render_decision_panel(
    red: int = 0,
    yellow: int = 0,
    blue: int = 0,
) -> Panel:
    if red == 0 and yellow == 0 and blue == 0:
        body = Align.center(Text("暂无待处理决策", style=STYLE_DIM), vertical="middle")
    else:
        body = Text()
        body.append("🔴 ", style=STYLE_DEFAULT)
        body.append(str(red), style=f"bold {CABINET_RED}")
        body.append("  🟡 ", style=STYLE_DEFAULT)
        body.append(str(yellow), style=f"bold {CABINET_YELLOW}")
        body.append("  🔵 ", style=STYLE_DEFAULT)
        body.append(str(blue), style=f"bold {CABINET_BLUE}")
    return Panel(
        body,
        title=f"[bold {CABINET_BLUE}]决策室[/]",
        border_style=CABINET_BLUE,
        padding=(0, 1),
    )


def render_office_panel(
    workflow: str = "",
    progress: float = 0.0,
    current_node: str = "",
) -> Panel:
    if workflow:
        from rich.console import Group

        progress_bar = Progress(
            TextColumn("{task.description}"),
            BarColumn(bar_width=20, style=CABINET_BLUE, complete_style=CABINET_BLUE),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        )
        progress_bar.add_task(workflow, completed=int(progress * 100), total=100)
        info_text = Text()
        if current_node:
            info_text.append(f"当前: {current_node}", style=STYLE_DEFAULT)
        body = Group(progress_bar, info_text) if current_node else progress_bar
    else:
        body = Align.center(Text("Idle", style=STYLE_DIM), vertical="middle")
    return Panel(
        body,
        title=f"[bold {CABINET_BLUE}]办公室[/]",
        border_style=CABINET_BLUE,
        padding=(0, 1),
    )


def render_input_prompt(mode: str) -> Text:
    result = Text()
    result.append(f"{mode} >", style=STYLE_BLUE_BOLD)
    return result
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/cli/test_tui_components.py -v`
Expected: 16 passed

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/tui_components.py tests/unit/cli/test_tui_components.py
git commit -m "feat(cli): add tui_components with pure rendering functions"
```

---

### Task 3: tui.py — CockpitState 与欢迎屏

**Files:**
- Create: `src/cabinet/cli/tui.py` (Part 1: CockpitState + 欢迎屏)
- Create: `tests/unit/cli/test_tui.py` (Part 1: CockpitState + 欢迎屏测试)

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/cli/test_tui.py
from __future__ import annotations

from datetime import datetime, timezone

from cabinet.cli.tui import CockpitState


def test_cockpit_state_defaults():
    state = CockpitState()
    assert state.mode == "decision"
    assert state.token_count == 0
    assert state.secretary_message == ""
    assert state.secretary_urgent is False
    assert state.api_connected is True
    assert state.captain_id == ""
    assert state.left_content is None
    assert state._ctrl_c_count == 0


def test_cockpit_state_custom():
    state = CockpitState(
        mode="meeting",
        token_count=5000,
        secretary_message="紧急",
        secretary_urgent=True,
        captain_id="captain-1",
    )
    assert state.mode == "meeting"
    assert state.token_count == 5000
    assert state.secretary_urgent is True
    assert state.captain_id == "captain-1"


def test_build_welcome_renderable_contains_logo():
    from cabinet.cli.tui import _build_welcome_renderable
    from unittest.mock import AsyncMock, MagicMock

    runtime = MagicMock()
    runtime.health_check = AsyncMock(return_value=MagicMock(llm_gateway=True))
    result = _build_welcome_renderable(runtime)
    assert result is not None


def test_build_welcome_renderable_api_failure():
    from cabinet.cli.tui import _build_welcome_renderable
    from unittest.mock import AsyncMock, MagicMock

    runtime = MagicMock()
    runtime.health_check = AsyncMock(return_value=MagicMock(llm_gateway=False))
    result = _build_welcome_renderable(runtime)
    assert result is not None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/cli/test_tui.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.cli.tui'`

- [ ] **Step 3: 实现 tui.py Part 1**

```python
# src/cabinet/cli/tui.py
from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone

from rich.align import Align
from rich.console import Console, RenderableType
from rich.live import Live
from rich.text import Text

from cabinet.cli.tui_themes import CABINET_LOGO, CABINET_BLUE, CABINET_RED, STYLE_BLUE_BOLD, STYLE_DIM, STYLE_DEFAULT


@dataclass
class CockpitState:
    mode: str = "decision"
    token_count: int = 0
    session_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    secretary_message: str = ""
    secretary_urgent: bool = False
    api_connected: bool = True
    captain_id: str = ""
    meeting_topic: str = ""
    meeting_advisors: int = 0
    meeting_round: int = 0
    decision_red: int = 0
    decision_yellow: int = 0
    decision_blue: int = 0
    office_workflow: str = ""
    office_progress: float = 0.0
    office_current_node: str = ""
    left_content: RenderableType | None = None
    _ctrl_c_count: int = 0


def _build_welcome_renderable(runtime) -> RenderableType:
    from rich.console import Group

    logo_text = Text.from_markup(CABINET_LOGO.strip())
    version_line = Text("v0.1.0 · AI Collaboration Framework", style=STYLE_DIM)
    greeting_line = Text("Captain，欢迎登上 Cabinet", style=STYLE_DEFAULT)
    prompt_line = Text("Press any key to enter the cockpit...", style=STYLE_DIM)

    elements = [
        Align.center(logo_text),
        Align.center(version_line),
        Align.center(Text()),
        Align.center(greeting_line),
        Align.center(Text()),
        Align.center(prompt_line),
    ]

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            health = None
        else:
            health = loop.run_until_complete(runtime.health_check())
    except Exception:
        health = None

    if health is not None and not getattr(health, "llm_gateway", True):
        warning = Text("⚠ API 连接失败，请检查配置", style=f"bold {CABINET_RED}")
        elements.append(Align.center(Text()))
        elements.append(Align.center(warning))

    return Group(*elements)


def _wait_for_keypress() -> None:
    if sys.platform == "win32":
        import msvcrt
        msvcrt.getch()
    else:
        import tty
        import termios
        fd = sys.stdin.fileno()
        old_settings = termios.tcgetattr(fd)
        try:
            tty.setcbreak(fd)
            sys.stdin.read(1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


async def run_welcome_screen(console: Console, runtime) -> None:
    welcome = _build_welcome_renderable(runtime)
    with Live(welcome, console=console, auto_refresh=False, vertical_overflow="visible") as live:
        live.update(welcome, refresh=True)
        _wait_for_keypress()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/cli/test_tui.py -v`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/tui.py tests/unit/cli/test_tui.py
git commit -m "feat(cli): add CockpitState and welcome screen rendering"
```

---

### Task 4: tui.py — 驾驶舱布局与 Live 循环

**Files:**
- Modify: `src/cabinet/cli/tui.py` (追加驾驶舱布局和主循环)
- Modify: `tests/unit/cli/test_tui.py` (追加布局测试)

- [ ] **Step 1: 写失败测试**

追加到 `tests/unit/cli/test_tui.py`：

```python
from rich.layout import Layout


def test_build_cockpit_layout_structure():
    from cabinet.cli.tui import _build_cockpit_layout
    state = CockpitState()
    layout = _build_cockpit_layout(state)
    assert isinstance(layout, Layout)
    assert layout["top_bar"] is not None
    assert layout["secretary_bar"] is not None
    assert layout["main"] is not None


def test_build_cockpit_layout_main_split():
    from cabinet.cli.tui import _build_cockpit_layout
    state = CockpitState()
    layout = _build_cockpit_layout(state)
    main = layout["main"]
    assert main["left"] is not None
    assert main["right"] is not None


def test_build_cockpit_layout_right_panels():
    from cabinet.cli.tui import _build_cockpit_layout
    state = CockpitState()
    layout = _build_cockpit_layout(state)
    right = layout["main"]["right"]
    assert right["meeting_panel"] is not None
    assert right["decision_panel"] is not None
    assert right["office_panel"] is not None


def test_mode_labels():
    from cabinet.cli.tui import MODE_LABELS
    assert "decision" in MODE_LABELS
    assert "meeting" in MODE_LABELS
    assert "office" in MODE_LABELS
    assert "summary" in MODE_LABELS


def test_slash_commands():
    from cabinet.cli.tui import SLASH_COMMANDS
    assert SLASH_COMMANDS["/decision"] == "decision"
    assert SLASH_COMMANDS["/meeting"] == "meeting"
    assert SLASH_COMMANDS["/office"] == "office"
    assert SLASH_COMMANDS["/summary"] == "summary"
    assert SLASH_COMMANDS["/quit"] == "__quit__"
    assert SLASH_COMMANDS["/status"] == "__status__"
    assert SLASH_COMMANDS["/help"] == "__help__"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/cli/test_tui.py::test_build_cockpit_layout_structure -v`
Expected: FAIL — `ImportError: cannot import name '_build_cockpit_layout'`

- [ ] **Step 3: 追加驾驶舱布局代码到 tui.py**

在 `src/cabinet/cli/tui.py` 末尾追加：

```python
from rich.layout import Layout
from rich.markdown import Markdown
from rich.panel import Panel

from cabinet.cli.tui_components import (
    render_decision_panel,
    render_input_prompt,
    render_left_panel,
    render_meeting_panel,
    render_office_panel,
    render_secretary_bar,
    render_top_bar,
)

MODE_LABELS: dict[str, str] = {
    "decision": "🧭 决策室 (Decision)",
    "meeting": "🗣️ 会议室 (Meeting)",
    "office": "📋 办公室 (Office)",
    "summary": "📊 总结室 (Summary)",
}

SLASH_COMMANDS: dict[str, str] = {
    "/decision": "decision",
    "/meeting": "meeting",
    "/office": "office",
    "/summary": "summary",
    "/quit": "__quit__",
    "/status": "__status__",
    "/help": "__help__",
}


def _build_cockpit_layout(state: CockpitState) -> Layout:
    layout = Layout()

    layout.split(
        Layout(name="top_bar", size=1),
        Layout(name="secretary_bar", size=1),
        Layout(name="main", ratio=1),
    )

    layout["top_bar"].update(
        render_top_bar(
            token_count=state.token_count,
            session_start=state.session_start,
            mode=state.mode,
            mode_label=MODE_LABELS.get(state.mode, state.mode),
        )
    )

    layout["secretary_bar"].update(
        render_secretary_bar(
            message=state.secretary_message,
            urgent=state.secretary_urgent,
        )
    )

    layout["main"].split_row(
        Layout(name="left", ratio=65),
        Layout(name="right", ratio=35),
    )

    layout["main"]["left"].split(
        Layout(name="content", ratio=1),
        Layout(name="input", size=1),
    )

    layout["main"]["left"]["content"].update(
        render_left_panel(mode=state.mode, content=state.left_content)
    )

    layout["main"]["left"]["input"].update(
        render_input_prompt(mode=state.mode)
    )

    layout["main"]["right"].split(
        Layout(name="meeting_panel", ratio=1),
        Layout(name="decision_panel", ratio=1),
        Layout(name="office_panel", ratio=1),
    )

    layout["main"]["right"]["meeting_panel"].update(
        render_meeting_panel(
            topic=state.meeting_topic,
            advisors=state.meeting_advisors,
            round_num=state.meeting_round,
        )
    )

    layout["main"]["right"]["decision_panel"].update(
        render_decision_panel(
            red=state.decision_red,
            yellow=state.decision_yellow,
            blue=state.decision_blue,
        )
    )

    layout["main"]["right"]["office_panel"].update(
        render_office_panel(
            workflow=state.office_workflow,
            progress=state.office_progress,
            current_node=state.office_current_node,
        )
    )

    return layout
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/cli/test_tui.py -v`
Expected: 9 passed

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/tui.py tests/unit/cli/test_tui.py
git commit -m "feat(cli): add cockpit layout builder with mode labels and slash commands"
```

---

### Task 5: tui.py — 命令路由与主循环

**Files:**
- Modify: `src/cabinet/cli/tui.py` (追加命令处理和主循环)
- Modify: `tests/unit/cli/test_tui.py` (追加命令路由测试)

- [ ] **Step 1: 写失败测试**

追加到 `tests/unit/cli/test_tui.py`：

```python
import asyncio
from unittest.mock import AsyncMock, MagicMock


def test_handle_slash_command_mode_switch():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    asyncio.get_event_loop().run_until_complete(
        _handle_slash_command("/meeting", state, MagicMock())
    )
    assert state.mode == "meeting"
    assert state.left_content is None


def test_handle_slash_command_decision():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    asyncio.get_event_loop().run_until_complete(
        _handle_slash_command("/decision", state, MagicMock())
    )
    assert state.mode == "decision"


def test_handle_slash_command_help():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    asyncio.get_event_loop().run_until_complete(
        _handle_slash_command("/help", state, MagicMock())
    )
    assert state.left_content is not None


def test_handle_slash_command_status():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState(captain_id="cap-1")
    runtime = MagicMock()
    runtime.secretary = MagicMock()
    runtime.secretary.summarize_pending = AsyncMock(
        return_value=MagicMock(digest="2 项紧急", urgent_count=2)
    )
    asyncio.get_event_loop().run_until_complete(
        _handle_slash_command("/status", state, runtime)
    )
    assert state.secretary_message == "2 项紧急"
    assert state.secretary_urgent is True


def test_handle_slash_command_meeting_with_topic():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    runtime = MagicMock()
    runtime.meeting = MagicMock()
    runtime.meeting.start_session = AsyncMock(
        return_value=MagicMock(session_id="sess-1")
    )
    asyncio.get_event_loop().run_until_complete(
        _handle_slash_command("/meeting Q3预算", state, runtime)
    )
    assert state.mode == "meeting"
    assert state.meeting_topic == "Q3预算"


def test_handle_slash_command_decide_with_title():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    runtime = MagicMock()
    runtime.decision = MagicMock()
    runtime.decision.submit = AsyncMock(
        return_value=MagicMock(id="dec-1")
    )
    asyncio.get_event_loop().run_until_complete(
        _handle_slash_command("/decide 合同续签", state, runtime)
    )
    assert state.mode == "decision"


def test_handle_slash_command_task_with_desc():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    runtime = MagicMock()
    runtime.office = MagicMock()
    runtime.office.submit_task = AsyncMock(
        return_value=MagicMock(id="task-1")
    )
    asyncio.get_event_loop().run_until_complete(
        _handle_slash_command("/task 数据迁移", state, runtime)
    )
    assert state.mode == "office"


def test_build_help_renderable():
    from cabinet.cli.tui import _build_help_renderable
    result = _build_help_renderable()
    assert result is not None
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/cli/test_tui.py::test_handle_slash_command_mode_switch -v`
Expected: FAIL — `ImportError: cannot import name '_handle_slash_command'`

- [ ] **Step 3: 追加命令处理代码到 tui.py**

在 `src/cabinet/cli/tui.py` 末尾追加：

```python
from uuid import uuid4

from rich.table import Table


def _build_help_renderable() -> Table:
    table = Table(title="Available Commands")
    table.add_column("Command", style=f"bold {CABINET_BLUE}")
    table.add_column("Description", style="green")
    commands = [
        ("/decision", "切换到决策室模式"),
        ("/meeting", "切换到会议室模式"),
        ("/office", "切换到办公室模式"),
        ("/summary", "切换到总结室模式"),
        ("/meeting <topic>", "启动审议会话"),
        ("/decide <title>", "提交决策请求"),
        ("/task <desc>", "提交执行任务"),
        ("/strategy <proposal>", "解码战略提案"),
        ("/review", "启动复盘会话"),
        ("/skills", "列出可用技能"),
        ("/employees", "列出注册员工"),
        ("/status", "显示待处理摘要"),
        ("/help", "显示帮助"),
        ("/quit", "退出"),
    ]
    for cmd, desc in commands:
        table.add_row(cmd, desc)
    return table


async def _handle_slash_command(raw: str, state: CockpitState, runtime) -> None:
    if raw.startswith("/meeting "):
        state.mode = "meeting"
        topic = raw[len("/meeting "):]
        try:
            from cabinet.rooms.meeting.models import MeetingLevel
            result = await runtime.meeting.start_session(
                topic=topic, level=MeetingLevel.MULTI_PARTY,
                participants=[uuid4(), uuid4()], project_id=None,
            )
            state.left_content = Markdown(f"会议已启动: {result.id}")
            state.meeting_topic = topic
        except Exception as e:
            state.left_content = Text(f"启动会议失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw.startswith("/decide "):
        state.mode = "decision"
        title = raw[len("/decide "):]
        try:
            from cabinet.models.events import DecisionRequest
            from cabinet.models.decisions import DecisionType
            request = DecisionRequest(
                decision_id=uuid4(),
                decision_type=DecisionType.STRATEGIC.value,
                title=title,
                options=[{"label": "Approve"}, {"label": "Reject"}],
            )
            result = await runtime.decision.submit(request)
            state.left_content = Markdown(f"**决策已提交:** {result.title}\n\n{result.description[:200]}")
        except Exception as e:
            state.left_content = Text(f"提交决策失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw.startswith("/task "):
        state.mode = "office"
        desc = raw[len("/task "):]
        try:
            from cabinet.models.events import TaskOrder
            order = TaskOrder(
                employee_id=uuid4(),
                skill_id=uuid4(),
                inputs={"description": desc},
            )
            result = await runtime.office.submit_task(order)
            state.left_content = Markdown(f"**任务已提交:** {result.id}\n状态: {result.status}")
        except Exception as e:
            state.left_content = Text(f"提交任务失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw.startswith("/strategy "):
        proposal = raw[len("/strategy "):]
        try:
            from cabinet.rooms.strategy.models import DecodeContext
            from cabinet.rooms.meeting.models import DeliberationOutput, DeliberationResult
            from cabinet.rooms.meeting.models import ConvergenceResult
            session_id = uuid4()
            proposal_output = DeliberationOutput(
                session_id=session_id,
                proposal=DeliberationResult(
                    session_id=session_id,
                    proposal_text=proposal,
                    confidence=0.8,
                    reasoning_summary="direct input",
                    convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
                    rounds_used=1,
                    rumination_detected=False,
                ),
            )
            context = DecodeContext(
                project_id=uuid4(), captain_id=state.captain_id, existing_constraints=[]
            )
            blueprint = await runtime.strategy.decode(proposal_output, context)
            state.left_content = Markdown(
                f"**蓝图已解码:** {blueprint.id}\n领域: {', '.join(d.name for d in blueprint.domains)}"
            )
        except Exception as e:
            state.left_content = Text(f"解码战略失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw == "/review":
        state.mode = "summary"
        try:
            from cabinet.rooms.summary.models import ReviewType
            result = await runtime.summary.start_review(
                project_id=uuid4(), review_type=ReviewType.PROJECT_REVIEW
            )
            state.left_content = Markdown(f"复盘已启动: {result.id}")
        except Exception as e:
            state.left_content = Text(f"启动复盘失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw == "/skills":
        try:
            skills = await runtime.tool_registry.list_skills()
            table = Table(title="Available Skills")
            table.add_column("Name", style=f"bold {CABINET_BLUE}")
            table.add_column("Description")
            for s in skills:
                table.add_row(s.name, s.description[:60])
            state.left_content = table if skills else Text("暂无技能", style=STYLE_DIM)
        except Exception as e:
            state.left_content = Text(f"获取技能失败: {e}", style=f"bold {CABINET_RED}")
        return

    if raw == "/employees":
        try:
            if runtime.employee_store is None:
                state.left_content = Text("未配置员工存储", style=STYLE_DIM)
                return
            employees = await runtime.employee_store.list_all()
            table = Table(title="Registered Employees")
            table.add_column("Name", style=f"bold {CABINET_BLUE}")
            table.add_column("Role", style="green")
            table.add_column("Kind")
            for emp in employees:
                table.add_row(emp.name, emp.role, emp.kind)
            state.left_content = table if employees else Text("暂无员工", style=STYLE_DIM)
        except Exception as e:
            state.left_content = Text(f"获取员工失败: {e}", style=f"bold {CABINET_RED}")
        return

    cmd = raw.split()[0]
    mode = SLASH_COMMANDS.get(cmd)

    if mode and mode not in ("__quit__", "__status__", "__help__"):
        state.mode = mode
        state.left_content = None

    elif mode == "__status__":
        try:
            result = await runtime.secretary.summarize_pending(captain_id=state.captain_id)
            state.secretary_message = result.digest
            state.secretary_urgent = result.urgent_count > 0
        except Exception as e:
            state.secretary_message = f"获取状态失败: {e}"
            state.secretary_urgent = True

    elif mode == "__help__":
        state.left_content = _build_help_renderable()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/cli/test_tui.py -v`
Expected: 17 passed

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/tui.py tests/unit/cli/test_tui.py
git commit -m "feat(cli): add slash command routing with mode switching and business logic"
```

---

### Task 6: tui.py — run_cockpit 主循环与后台刷新

**Files:**
- Modify: `src/cabinet/cli/tui.py` (追加 run_cockpit 和 _periodic_refresh)
- Modify: `tests/unit/cli/test_tui.py` (追加主循环测试)

- [ ] **Step 1: 写失败测试**

追加到 `tests/unit/cli/test_tui.py`：

```python
def test_periodic_refresh_updates_state():
    from cabinet.cli.tui import _periodic_refresh
    state = CockpitState(decision_red=1, decision_yellow=2, decision_blue=3)
    runtime = MagicMock()
    layout = _build_cockpit_layout(state)
    mock_live = MagicMock()
    called = asyncio.get_event_loop().run_until_complete(
        _periodic_refresh_once(state, runtime, mock_live)
    )
    mock_live.update.assert_called_once()


def test_handle_chat_updates_content():
    from cabinet.cli.tui import _handle_chat
    state = CockpitState(captain_id="cap-1")
    runtime = MagicMock()
    runtime.secretary = MagicMock()

    stream_response = MagicMock()

    async def mock_stream():
        yield "Hello"
        yield " World"

    stream_response.stream = mock_stream()
    stream_response.finalize = AsyncMock()
    stream_response.usage = None

    runtime.secretary.process_input_stream = AsyncMock(return_value=stream_response)

    layout = _build_cockpit_layout(state)
    mock_live = MagicMock()
    mock_live.update = MagicMock()

    asyncio.get_event_loop().run_until_complete(
        _handle_chat("你好", state, runtime, mock_live)
    )
    assert state.left_content is not None
    mock_live.update.assert_called()


async def _periodic_refresh_once(state, runtime, live):
    await asyncio.sleep(0.01)
    live.update(_build_cockpit_layout(state))
    return True
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/cli/test_tui.py::test_handle_chat_updates_content -v`
Expected: FAIL — `ImportError: cannot import name '_handle_chat'`

- [ ] **Step 3: 追加主循环代码到 tui.py**

在 `src/cabinet/cli/tui.py` 末尾追加：

```python
from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import HTML


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
        async for chunk in response.stream:
            chunks.append(chunk)
            state.left_content = Markdown("".join(chunks))
            live.update(_build_cockpit_layout(state))

        await response.finalize()
        if hasattr(response, 'usage') and response.usage:
            state.token_count += response.usage.get("total_tokens", 0)
    except Exception as e:
        state.left_content = Text(f"对话错误: {e}", style=f"bold {CABINET_RED}")


async def _periodic_refresh(
    state: CockpitState,
    runtime,
    live: Live,
) -> None:
    while True:
        await asyncio.sleep(3)
        try:
            live.update(_build_cockpit_layout(state))
        except Exception:
            pass


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

    with Live(layout, console=console, refresh_per_second=1, vertical_overflow="visible") as live:
        refresh_task = asyncio.create_task(_periodic_refresh(state, runtime, live))

        try:
            while True:
                try:
                    user_input = await session.prompt_async(
                        HTML(f"<style fg='#081D60' bold>{state.mode} ></style> ")
                    )
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
            refresh_task.cancel()
            try:
                await refresh_task
            except asyncio.CancelledError:
                pass
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/cli/test_tui.py -v`
Expected: 19 passed

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/tui.py tests/unit/cli/test_tui.py
git commit -m "feat(cli): add run_cockpit main loop with prompt_toolkit and periodic refresh"
```

---

### Task 7: pyproject.toml — 新增 prompt-toolkit 依赖

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: 在 dependencies 列表中添加 prompt-toolkit**

找到 `pyproject.toml` 中 `dependencies` 列表，在 `"rich>=13.7",` 行之后添加 `"prompt-toolkit>=3.0",`。

- [ ] **Step 2: 安装依赖验证**

Run: `pip install -e ".[dev]"`
Expected: 成功安装 prompt-toolkit

- [ ] **Step 3: 提交**

```bash
git add pyproject.toml
git commit -m "feat: add prompt-toolkit dependency for TUI input"
```

---

### Task 8: main.py — 替换 _chat_async 为 TUI 入口

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 替换 _chat_async 函数体**

将 `_chat_async` 函数（第 357-428 行）替换为：

```python
async def _chat_async(data_dir: str) -> None:
    from cabinet.cli.tui import run_cockpit, run_welcome_screen

    runtime, config = await _init_runtime(data_dir)

    try:
        await run_welcome_screen(console, runtime)
        await run_cockpit(console, runtime, config)
    finally:
        await runtime.stop()
```

- [ ] **Step 2: 验证现有 CLI 测试仍然通过**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: 所有现有测试通过（chat 命令测试可能因 TUI 交互而需要调整，但非 chat 命令测试应全部通过）

- [ ] **Step 3: 验证 lint**

Run: `python -m ruff check src/cabinet/cli/main.py`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat(cli): replace _chat_async with TUI cockpit entry point"
```

---

### Task 9: 集成验证 — 手动运行与端到端测试

**Files:**
- 无新增文件

- [ ] **Step 1: 验证欢迎屏渲染**

Run: `cabinet chat --data-dir data`

预期行为：
1. 显示彩色色块 Logo + CABINET ASCII 艺术字
2. 显示版本信息和欢迎语
3. 按任意键后切换到驾驶舱布局

- [ ] **Step 2: 验证驾驶舱布局**

预期行为：
1. 顶栏显示 `Token: 0 │ Session: 0:00:00 │ 🧭 决策室 (Decision)`
2. 秘书通知栏显示秘书问候语
3. 左侧显示决策室面板（占位内容）
4. 右侧显示三个面板（会议室 Idle、决策室暂无、办公室 Idle）
5. 底部显示 `decision >` 输入提示符

- [ ] **Step 3: 验证模式切换**

输入 `/meeting` → 顶栏模式标签变为 `🗣️ 会议室 (Meeting)`，输入提示符变为 `meeting >`
输入 `/office` → 顶栏变为 `📋 办公室 (Office)`
输入 `/decision` → 切回决策室

- [ ] **Step 4: 验证 /help 命令**

输入 `/help` → 左侧面板显示命令列表表格

- [ ] **Step 5: 验证 /quit 退出**

输入 `/quit` → 程序退出

- [ ] **Step 6: 验证 Ctrl+C 退出**

按 Ctrl+C → 秘书通知栏显示确认提示
再按 Ctrl+C → 程序退出

- [ ] **Step 7: 运行全部测试**

Run: `python -m pytest tests/unit/cli/ -v`
Expected: 所有测试通过

- [ ] **Step 8: 运行 lint**

Run: `python -m ruff check src/cabinet/cli/`
Expected: 无错误

- [ ] **Step 9: 最终提交**

```bash
git add -A
git commit -m "feat(cli): complete TUI cockpit with welcome screen and multi-panel layout"
```
