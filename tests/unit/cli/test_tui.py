from __future__ import annotations

from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.document import Document

from cabinet.cli.tui import CockpitState


def test_cockpit_state_defaults():
    state = CockpitState()
    assert state.mode == "decision"
    assert state.token_count == 0
    assert state.secretary_message == ""
    assert state.secretary_urgent is False
    assert state.api_connected is True
    assert state.captain_id == ""
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
