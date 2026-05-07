from __future__ import annotations

from textual.containers import VerticalScroll
from textual.widgets import Markdown, Static


ASSISTANT_COLOR = "#E2E8F0"
USER_COLOR = "#64748B"


class ConversationView(VerticalScroll):
    """Scrollable conversation display with user messages and AI responses."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._messages: list[dict] = []

    def clear(self) -> None:
        self._messages = []
        self.remove_children()
        self.mount(Static("开始对话吧...", id="placeholder"))

    def add_user_message(self, text: str) -> None:
        self._remove_placeholder()
        self._messages.append({"role": "user", "content": text})
        self.mount(Static(f"💬 {text}", classes="user-message"))

    def add_assistant_message(self, text: str) -> None:
        self._remove_placeholder()
        self._messages.append({"role": "assistant", "content": text})
        self.mount(Markdown(text, classes="assistant-message"))

    def update_streaming(self, partial_text: str) -> None:
        """Update the in-progress assistant message during streaming."""
        pass  # handled by CockpitScreen worker

    def _remove_placeholder(self) -> None:
        placeholder = self.query_one("#placeholder")
        if placeholder:
            placeholder.remove()

    @property
    def messages(self) -> list[dict]:
        return list(self._messages)


def _render_user_message(msg: dict) -> Static:
    return Static(f"💬 {msg['content']}")


def _render_assistant_message(msg: dict) -> Markdown:
    return Markdown(msg["content"])
