import tempfile
import os

from cabinet.cli.widgets.input_area import InputArea, _filter_completions, SLASH_COMMANDS_LIST


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


def test_input_area_history_persisted():
    """History is saved to and loaded from file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        area1 = InputArea(data_dir=tmpdir)
        area1._add_to_history("test_command")

        area2 = InputArea(data_dir=tmpdir)
        assert "test_command" in area2._history


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
