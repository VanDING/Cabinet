from __future__ import annotations

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Static


class ThinkingPanel(Vertical):
    """Collapsible thinking chain display."""

    def compose(self) -> ComposeResult:
        yield Static("", id="thinking-header")
        yield Static("", id="thinking-steps")

    def update_state(self, steps: list[str], expanded: bool) -> None:
        self.display = bool(steps)
        if not steps:
            return
        if expanded:
            header = f"💭 思考链 (共{len(steps)}步，Ctrl+T 折叠)"
            body = "\n".join(f"{i}. {s}" for i, s in enumerate(steps, 1))
        else:
            header = f"💭 思考中... (共{len(steps)}步，Ctrl+T 展开)"
            body = ""
        self.query_one("#thinking-header").update(header)
        self.query_one("#thinking-steps").update(body)
