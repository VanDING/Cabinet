from __future__ import annotations

from cabinet.cli.screens.cockpit import CockpitScreen


def test_cockpit_screen_reactive_defaults():
    """Verify reactive attributes have correct defaults."""
    assert CockpitScreen.mode._default == "decision"
    assert CockpitScreen.token_count._default == 0
    assert CockpitScreen.elapsed_seconds._default == 0
    assert CockpitScreen.secretary_message._default == ""
    assert CockpitScreen.secretary_urgent._default is False
    assert CockpitScreen.captain_id._default == ""
    assert CockpitScreen.api_connected._default is True


def test_cockpit_screen_thinking_defaults():
    assert CockpitScreen.thinking_steps._default is list  # factory, mutable-safe
    assert CockpitScreen.thinking_expanded._default is False


def test_cockpit_screen_panel_defaults():
    assert CockpitScreen.meeting_topic._default == ""
    assert CockpitScreen.meeting_advisors._default == 0
    assert CockpitScreen.decision_red._default == 0
    assert CockpitScreen.office_workflow._default == ""
    assert CockpitScreen.office_progress._default == 0.0


def test_format_elapsed():
    """Test _format_elapsed formatting."""
    from cabinet.cli.screens.cockpit import CockpitScreen

    class FakeScreen:
        elapsed_seconds = 0

    screen = FakeScreen()
    screen.elapsed_seconds = 0
    result = CockpitScreen._format_elapsed(screen)
    assert result == "0:00:00"

    screen.elapsed_seconds = 65
    result = CockpitScreen._format_elapsed(screen)
    assert result == "0:01:05"

    screen.elapsed_seconds = 3661
    result = CockpitScreen._format_elapsed(screen)
    assert result == "1:01:01"


def test_split_thinking_steps():
    """_split_thinking_steps splits by newlines and filters empty."""
    from cabinet.cli.screens.cockpit import _split_thinking_steps
    result = _split_thinking_steps("第一步\n第二步\n\n第三步")
    assert result == ["第一步", "第二步", "第三步"]


def test_split_thinking_steps_empty():
    from cabinet.cli.screens.cockpit import _split_thinking_steps
    assert _split_thinking_steps("") == []


def test_split_thinking_steps_whitespace_only():
    from cabinet.cli.screens.cockpit import _split_thinking_steps
    assert _split_thinking_steps("   \n  \n  ") == []


def test_mode_labels_exist():
    """Verify MODE_LABELS in Header covers all modes."""
    from cabinet.cli.widgets.header import Header
    assert "decision" in Header.MODE_LABELS
    assert "meeting" in Header.MODE_LABELS
    assert "office" in Header.MODE_LABELS
    assert "summary" in Header.MODE_LABELS
