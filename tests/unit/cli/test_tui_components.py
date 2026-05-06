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
    from rich.console import Console
    result = render_meeting_panel()
    assert isinstance(result, Panel)
    assert "会议室" in result.title
    console = Console(width=120, force_terminal=True)
    with console.capture() as capture:
        console.print(result.renderable)
    assert "Idle" in capture.get()


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
    from rich.console import Console
    result = render_office_panel(workflow="数据迁移", progress=0.65, current_node="验证阶段")
    console = Console(width=120, force_terminal=True)
    with console.capture() as capture:
        console.print(result.renderable)
    rendered = capture.get()
    assert "数据迁移" in rendered or "65" in rendered


def test_render_input_prompt():
    result = render_input_prompt("decision")
    assert isinstance(result, Text)
    assert "decision" in result.plain
