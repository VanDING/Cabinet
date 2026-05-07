from __future__ import annotations

from datetime import datetime, timezone

from rich.align import Align
from rich.console import RenderableType
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
    if message:
        display = message if len(message) <= 200 else message[:200] + "…"
    else:
        display = "Captain，一切正常"
    style = STYLE_BLUE_BOLD if urgent else STYLE_DEFAULT
    result = Text()
    result.append("📋 秘书：", style=STYLE_DEFAULT)
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
