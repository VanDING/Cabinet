from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.screen import Screen
from textual.widgets import Footer, Input, Static

from cabinet.cli.state import CockpitState


class CockpitScreen(Screen):
    """Main cockpit TUI screen."""

    BINDINGS = [
        ("ctrl+t", "toggle_thinking", "Toggle Thinking"),
        ("ctrl+c", "request_quit", "Quit"),
    ]

    def __init__(self, runtime, config, data_dir: str):
        super().__init__()
        self.runtime = runtime
        self.config = config
        self.data_dir = data_dir
        self.state = CockpitState()

    def compose(self) -> ComposeResult:
        yield Static("Token: 0 │ Session: 0:00:00 │ 🧭 决策室", id="header")
        yield Static("📋 秘书：Captain，一切正常", id="secretary-bar")
        with Horizontal(id="main-area"):
            with Vertical(id="left-content"):
                with VerticalScroll(id="conversation-view"):
                    yield Static("开始对话吧...", id="conversation")
            with Vertical(id="right-panel"):
                yield Static("会议室\nIdle", id="meeting-panel")
                yield Static("决策室\n暂无决策", id="decision-panel")
                yield Static("办公室\nIdle", id="office-panel")
        yield Input(placeholder="decision > ", id="input-area")

    def on_mount(self) -> None:
        self._greet()

    async def _greet(self) -> None:
        try:
            greeting = await self.runtime.secretary.greet(
                captain_id=self.config.organization.captain_id
            )
            self.state.secretary_message = greeting.message
            self.state.captain_id = self.config.organization.captain_id
            self.query_one("#secretary-bar").update(
                f"📋 秘书：{greeting.message}"
            )
        except Exception:
            self.query_one("#secretary-bar").update(
                "📋 秘书：秘书服务连接失败"
            )

    def action_toggle_thinking(self) -> None:
        self.state.thinking_expanded = not self.state.thinking_expanded

    def action_request_quit(self) -> None:
        self.app.exit()
