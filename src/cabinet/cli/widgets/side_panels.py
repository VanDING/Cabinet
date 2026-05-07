from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Static, ProgressBar

from cabinet.cli.state import CockpitState


class MeetingPanel(Vertical):
    """Meeting room status panel."""

    def compose(self) -> ComposeResult:
        yield Static("会议室", classes="panel-title")
        yield Static("Idle", id="meeting-content")

    def update_state(self, state: CockpitState) -> None:
        if state.meeting_topic:
            self.query_one("#meeting-content").update(
                f"议题: {state.meeting_topic}\n"
                f"顾问: {state.meeting_advisors} · 轮次: {state.meeting_round}"
            )
        else:
            self.query_one("#meeting-content").update("Idle")


class DecisionPanel(Vertical):
    """Decision room status panel."""

    def compose(self) -> ComposeResult:
        yield Static("决策室", classes="panel-title")
        yield Static("暂无决策", id="decision-content")

    def update_state(self, state: CockpitState) -> None:
        r, y, b = state.decision_red, state.decision_yellow, state.decision_blue
        if r == y == b == 0:
            self.query_one("#decision-content").update("暂无决策")
        else:
            self.query_one("#decision-content").update(
                f"🔴 战略: {r}  🟡 战术: {y}  🔵 执行: {b}"
            )


class OfficePanel(Vertical):
    """Office room status panel."""

    def compose(self) -> ComposeResult:
        yield Static("办公室", classes="panel-title")
        yield ProgressBar(total=100, id="office-progress")
        yield Static("Idle", id="office-content")

    def update_state(self, state: CockpitState) -> None:
        progress = self.query_one("#office-progress", ProgressBar)
        if state.office_workflow:
            progress.update(progress=int(state.office_progress * 100))
            self.query_one("#office-content").update(
                f"{state.office_workflow}\n当前: {state.office_current_node}"
            )
        else:
            progress.update(progress=0)
            self.query_one("#office-content").update("Idle")
