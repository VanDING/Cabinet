from __future__ import annotations

from textual.app import App


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
        from cabinet.cli.screens.welcome import WelcomeScreen

        self.push_screen(WelcomeScreen(self.runtime))
