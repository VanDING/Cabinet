from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Static, ProgressBar

class MeetingPanel(Vertical):
    """Meeting room status panel."""

    def compose(self) -> ComposeResult:
        yield Static("会议室", classes="panel-title")
        yield Static("Idle", id="meeting-content")

    def update_state(self, topic: str = "", advisors: int = 0, round_num: int = 0) -> None:
        if topic:
            self.query_one("#meeting-content").update(
                f"议题: {topic}\n"
                f"顾问: {advisors} · 轮次: {round_num}"
            )
        else:
            self.query_one("#meeting-content").update("Idle")


class DecisionPanel(Vertical):
    """Decision room status panel."""

    def compose(self) -> ComposeResult:
        yield Static("决策室", classes="panel-title")
        yield Static("暂无决策", id="decision-content")

    def update_state(self, red: int = 0, yellow: int = 0, blue: int = 0) -> None:
        if red == yellow == blue == 0:
            self.query_one("#decision-content").update("暂无决策")
        else:
            self.query_one("#decision-content").update(
                f"\U0001f534 战略: {red}  \U0001f7e1 战术: {yellow}  \U0001f535 执行: {blue}"
            )


class OfficePanel(Vertical):
    """Office room status panel."""

    def compose(self) -> ComposeResult:
        yield Static("办公室", classes="panel-title")
        yield ProgressBar(total=100, id="office-progress")
        yield Static("Idle", id="office-content")

    def update_state(self, workflow: str = "", progress: float = 0.0, current_node: str = "") -> None:
        bar = self.query_one("#office-progress", ProgressBar)
        if workflow:
            bar.update(progress=int(progress * 100))
            self.query_one("#office-content").update(
                f"{workflow}\n当前: {current_node}"
            )
        else:
            bar.update(progress=0)
            self.query_one("#office-content").update("Idle")
