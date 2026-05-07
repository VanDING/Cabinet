from __future__ import annotations

from pathlib import Path

from textual.app import ComposeResult
from textual.containers import Vertical
from textual.widgets import Input, ListView, ListItem, Static


SLASH_COMMANDS_LIST = [
    "/decision", "/meeting", "/office", "/summary",
    "/decide", "/task", "/strategy", "/review",
    "/skills", "/employees", "/status", "/help", "/quit",
]

SLASH_COMMAND_DESCRIPTIONS = {
    "/decision": "切换决策室",
    "/meeting": "切换会议室 / 启动审议",
    "/office": "切换办公室",
    "/summary": "切换总结室",
    "/decide": "提交决策请求",
    "/task": "提交执行任务",
    "/strategy": "解码战略提案",
    "/review": "启动复盘",
    "/skills": "列出可用技能",
    "/employees": "列出注册员工",
    "/status": "显示待处理摘要",
    "/help": "显示帮助",
    "/quit": "退出",
}


def _filter_completions(text: str) -> list[str]:
    if not text.startswith("/"):
        return []
    return [cmd for cmd in SLASH_COMMANDS_LIST if cmd.startswith(text)]


class InputArea(Vertical):
    """Input area with command completion overlay."""

    _completion_visible: bool = False

    PLACEHOLDERS = {
        "decision": "decision > ",
        "meeting": "meeting > ",
        "office": "office > ",
        "summary": "summary > ",
    }

    BINDINGS = [
        ("up", "history_prev", "Previous command"),
        ("down", "history_next", "Next command"),
    ]

    def set_placeholder(self, mode: str) -> None:
        """Update input placeholder based on current room mode."""
        placeholder = self.PLACEHOLDERS.get(mode, f"{mode} > ")
        self.query_one("#prompt-input", Input).placeholder = placeholder

    def __init__(self, data_dir: str = "", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._data_dir = data_dir
        self._history: list[str] = []
        self._history_index: int = -1
        self._load_history()

    def compose(self) -> ComposeResult:
        yield ListView(id="completion-list", classes="completion-overlay")
        yield Input(placeholder="decision > ", id="prompt-input")

    def on_input_changed(self, event: Input.Changed) -> None:
        value = event.value or ""
        if value.startswith("/"):
            matches = _filter_completions(value)
            if matches:
                self._show_completions(matches)
                return
        self._hide_completions()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.value and event.value.strip():
            self._add_to_history(event.value.strip())

    def _show_completions(self, matches: list[str]) -> None:
        lv = self.query_one("#completion-list", ListView)
        lv.clear()
        for m in matches:
            desc = SLASH_COMMAND_DESCRIPTIONS.get(m, "")
            item_text = f"{m}  {desc}" if desc else m
            lv.append(ListItem(Static(item_text)))
        lv.display = True
        self._completion_visible = True

    def _hide_completions(self) -> None:
        self.query_one("#completion-list", ListView).display = False
        self._completion_visible = False

    def on_list_view_selected(self, event: ListView.Selected) -> None:
        """When user selects a completion item, fill the input."""
        static_widget = event.item.query_one(Static)
        text = str(static_widget.renderable)
        cmd = text.split()[0]  # Extract "/decision" from "/decision  切换决策室"
        inp = self.query_one("#prompt-input", Input)
        inp.value = cmd + " "
        inp.cursor_position = len(inp.value)
        self._hide_completions()

    def _add_to_history(self, text: str) -> None:
        if not self._history or self._history[-1] != text:
            self._history.append(text)
        self._history_index = -1
        self._save_history()

    def _save_history(self) -> None:
        try:
            history_path = Path(self._data_dir) / ".chat_history"
            history_path.parent.mkdir(parents=True, exist_ok=True)
            with open(history_path, "w", encoding="utf-8") as f:
                for line in self._history[-1000:]:
                    f.write(line + "\n")
        except Exception:
            pass

    def _load_history(self) -> None:
        try:
            history_path = Path(self._data_dir) / ".chat_history"
            if history_path.exists():
                with open(history_path, encoding="utf-8") as f:
                    self._history = [line.rstrip("\n") for line in f if line.strip()]
        except Exception:
            self._history = []

    def action_history_prev(self) -> None:
        """Navigate to previous command in history."""
        if not self._history:
            return
        if self._history_index < len(self._history) - 1:
            self._history_index += 1
        idx = len(self._history) - 1 - self._history_index
        inp = self.query_one("#prompt-input", Input)
        inp.value = self._history[idx]
        inp.cursor_position = len(inp.value)

    def action_history_next(self) -> None:
        """Navigate to next command in history."""
        if self._history_index <= 0:
            self._history_index = -1
            self.query_one("#prompt-input", Input).value = ""
            return
        self._history_index -= 1
        idx = len(self._history) - 1 - self._history_index
        self.query_one("#prompt-input", Input).value = self._history[idx]
