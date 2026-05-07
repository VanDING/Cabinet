from __future__ import annotations

from textual.widgets import Static


class Header(Static):
    """Top bar showing token count, session time, and current mode."""

    MODE_LABELS = {
        "decision": "\U0001f9ed 决策室 (Decision)",
        "meeting": "\U0001f5e3️ 会议室 (Meeting)",
        "office": "\U0001f4cb 办公室 (Office)",
        "summary": "\U0001f4ca 总结室 (Summary)",
    }

    def on_mount(self) -> None:
        self.update("Token: 0 │ Session: 0:00:00 │ \U0001f9ed 决策室")

    def update_info(self, token_count: int, elapsed: str, mode: str) -> None:
        mode_label = self.MODE_LABELS.get(mode, mode)
        self.update(
            f"Token: {token_count} │ Session: {elapsed} │ {mode_label}"
        )
