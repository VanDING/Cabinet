from __future__ import annotations

from textual.app import ComposeResult
from textual.widgets import Static


class Header(Static):
    """Top bar showing token count, session time, and current mode."""

    MODE_LABELS = {
        "decision": "🧭 决策室 (Decision)",
        "meeting": "🗣️ 会议室 (Meeting)",
        "office": "📋 办公室 (Office)",
        "summary": "📊 总结室 (Summary)",
    }

    def compose(self) -> ComposeResult:
        yield Static("Token: 0 │ Session: 0:00:00 │ 🧭 决策室", id="header-text")

    def update_info(self, token_count: int, elapsed: str, mode: str) -> None:
        mode_label = self.MODE_LABELS.get(mode, mode)
        self.query_one("#header-text").update(
            f"Token: {token_count} │ Session: {elapsed} │ {mode_label}"
        )
