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
