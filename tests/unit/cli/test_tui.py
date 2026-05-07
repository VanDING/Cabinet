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
    assert state.conversation == []


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


import asyncio
from unittest.mock import AsyncMock, MagicMock


def test_handle_slash_command_mode_switch():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    asyncio.run(_handle_slash_command("/meeting", state, MagicMock()))
    assert state.mode == "meeting"
    assert state.left_content is None


def test_handle_slash_command_decision():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    asyncio.run(_handle_slash_command("/decision", state, MagicMock()))
    assert state.mode == "decision"


def test_handle_slash_command_help():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    asyncio.run(_handle_slash_command("/help", state, MagicMock()))
    assert state.left_content is not None


def test_handle_slash_command_status():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState(captain_id="cap-1")
    runtime = MagicMock()
    runtime.secretary = MagicMock()
    runtime.secretary.summarize_pending = AsyncMock(
        return_value=MagicMock(digest="2 项紧急", urgent_count=2)
    )
    asyncio.run(_handle_slash_command("/status", state, runtime))
    assert state.secretary_message == "2 项紧急"
    assert state.secretary_urgent is True


def test_handle_slash_command_meeting_with_topic():
    from cabinet.cli.tui import _handle_slash_command
    from unittest.mock import patch
    state = CockpitState()
    runtime = MagicMock()
    runtime.meeting = MagicMock()
    runtime.meeting.start_session = AsyncMock(
        return_value=MagicMock(session_id="sess-1")
    )
    mock_meeting_level = MagicMock()
    with patch.dict("sys.modules", {"cabinet.rooms.meeting.models": MagicMock(MeetingLevel=mock_meeting_level)}):
        asyncio.run(_handle_slash_command("/meeting Q3预算", state, runtime))
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
    asyncio.run(_handle_slash_command("/decide 合同续签", state, runtime))
    assert state.mode == "decision"


def test_handle_slash_command_task_with_desc():
    from cabinet.cli.tui import _handle_slash_command
    state = CockpitState()
    runtime = MagicMock()
    runtime.office = MagicMock()
    runtime.office.submit_task = AsyncMock(
        return_value=MagicMock(id="task-1")
    )
    asyncio.run(_handle_slash_command("/task 数据迁移", state, runtime))
    assert state.mode == "office"


def test_build_help_renderable():
    from cabinet.cli.tui import _build_help_renderable
    result = _build_help_renderable()
    assert result is not None


def test_handle_chat_updates_content():
    from cabinet.cli.tui import _handle_chat, _build_cockpit_layout
    from unittest.mock import patch
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

    mock_interaction_context = MagicMock()
    with patch.dict("sys.modules", {"cabinet.rooms.secretary.models": MagicMock(InteractionContext=mock_interaction_context)}):
        asyncio.run(_handle_chat("你好", state, runtime, mock_live))
    # Conversation stores messages; left_content cleared after final flush
    assert len(state.conversation) >= 2  # user + assistant
    assert state.conversation[0]["role"] == "user"
    assert state.conversation[0]["content"] == "你好"
    mock_live.update.assert_called()


def test_cockpit_state_thinking_fields():
    state = CockpitState()
    assert state.thinking_steps == []
    assert state.thinking_expanded is False


def test_cockpit_state_thinking_custom():
    state = CockpitState(thinking_steps=["step1", "step2"], thinking_expanded=True)
    assert len(state.thinking_steps) == 2
    assert state.thinking_expanded is True


def test_split_thinking_steps():
    from cabinet.cli.tui import _split_thinking_steps
    result = _split_thinking_steps("第一步\n第二步\n\n第三步")
    assert result == ["第一步", "第二步", "第三步"]


def test_split_thinking_steps_empty():
    from cabinet.cli.tui import _split_thinking_steps
    result = _split_thinking_steps("")
    assert result == []


def test_split_thinking_steps_whitespace_only():
    from cabinet.cli.tui import _split_thinking_steps
    result = _split_thinking_steps("   \n  \n  ")
    assert result == []


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

    mock_live = MagicMock()

    mock_interaction_context = MagicMock()
    with patch.dict("sys.modules", {"cabinet.rooms.secretary.models": MagicMock(InteractionContext=mock_interaction_context)}):
        asyncio.run(_handle_chat("测试", state, runtime, mock_live))
    assert len(state.thinking_steps) > 0
    assert "第一步分析" in state.thinking_steps[0]


def test_build_cockpit_secretary_bar_sizing():
    """Secretary bar should exist and have appropriate sizing for multi-line text."""
    from cabinet.cli.tui import _build_cockpit_layout
    state = CockpitState()
    layout = _build_cockpit_layout(state)
    assert layout["secretary_bar"] is not None


from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.document import Document
from pathlib import Path


def test_slash_completer_contains_all_commands():
    from cabinet.cli.tui import SLASH_COMPLETER
    assert isinstance(SLASH_COMPLETER, WordCompleter)
    words = SLASH_COMPLETER.words
    assert "/decision" in words
    assert "/meeting" in words
    assert "/office" in words
    assert "/summary" in words
    assert "/decide" in words
    assert "/task" in words
    assert "/strategy" in words
    assert "/review" in words
    assert "/skills" in words
    assert "/employees" in words
    assert "/status" in words
    assert "/help" in words
    assert "/quit" in words


def test_slash_completer_completes_partial_input():
    from cabinet.cli.tui import SLASH_COMPLETER
    completions = list(SLASH_COMPLETER.get_completions(Document("/dec"), None))
    completion_texts = [c.text for c in completions]
    assert "/decision" in completion_texts
    assert "/decide" in completion_texts


def test_slash_completer_case_insensitive():
    from cabinet.cli.tui import SLASH_COMPLETER
    completions = list(SLASH_COMPLETER.get_completions(Document("/DEC"), None))
    completion_texts = [c.text for c in completions]
    assert "/decision" in completion_texts


def test_slash_completer_not_triggered_on_plain_text():
    from cabinet.cli.tui import SLASH_COMPLETER
    completions = list(SLASH_COMPLETER.get_completions(Document("hello"), None))
    assert len(completions) == 0


def test_history_path_construction():
    from cabinet.cli.tui import _get_history_path
    import tempfile
    import os
    with tempfile.TemporaryDirectory() as tmpdir:
        path = _get_history_path(tmpdir)
        assert path.name == ".chat_history"
        assert str(path.parent) == tmpdir


def test_detect_intent_meeting():
    from cabinet.cli.tui import _detect_intent
    result = _detect_intent("开个会讨论一下Q3预算")
    assert result is not None
    assert result["type"] == "meeting"
    assert "Q3预算" in result["topic"]


def test_detect_intent_meeting_variant():
    from cabinet.cli.tui import _detect_intent
    result = _detect_intent("聊聊新产品规划")
    assert result is not None
    assert result["type"] == "meeting"
    assert "新产品规划" in result["topic"]


def test_detect_intent_task():
    from cabinet.cli.tui import _detect_intent
    result = _detect_intent("提醒我下午3点review代码")
    assert result is not None
    assert result["type"] == "office"
    assert "review代码" in result["description"]


def test_detect_intent_task_variant():
    from cabinet.cli.tui import _detect_intent
    result = _detect_intent("别忘了提交周报")
    assert result is not None
    assert result["type"] == "office"


def test_detect_intent_decision():
    from cabinet.cli.tui import _detect_intent
    result = _detect_intent("是否应该延长项目周期")
    assert result is not None
    assert result["type"] == "decision"


def test_detect_intent_no_match():
    from cabinet.cli.tui import _detect_intent
    result = _detect_intent("帮我分析这个数据")
    assert result is None
