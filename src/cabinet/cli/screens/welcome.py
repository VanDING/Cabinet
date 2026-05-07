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
