"""DEPRECATED: TUI functions have been migrated to Textual widgets.

See:
- src/cabinet/cli/app.py              for CabinetApp
- src/cabinet/cli/screens/cockpit.py  for CockpitScreen
- src/cabinet/cli/state.py            for CockpitState
- src/cabinet/cli/intent.py           for intent detection
"""

from __future__ import annotations

from pathlib import Path

# Re-export CockpitState for backward compat
from cabinet.cli.state import CockpitState  # noqa: F401

# Re-export intent functions
from cabinet.cli.intent import detect_intent as _detect_intent  # noqa: F401
from cabinet.cli.intent import execute_intent as _execute_intent  # noqa: F401

# Legacy constants kept for test compat
MODE_LABELS: dict[str, str] = {
    "decision": "\U0001f9ed 决策室 (Decision)",
    "meeting": "\U0001f5e3️ 会议室 (Meeting)",
    "office": "\U0001f4cb 办公室 (Office)",
    "summary": "\U0001f4ca 总结室 (Summary)",
}

SLASH_COMMANDS: dict[str, str] = {
    "/decision": "decision",
    "/meeting": "meeting",
    "/office": "office",
    "/summary": "summary",
    "/quit": "__quit__",
    "/status": "__status__",
    "/help": "__help__",
}

from prompt_toolkit.completion import WordCompleter  # noqa: E402

SLASH_COMPLETER = WordCompleter(
    ["/decision", "/meeting", "/office", "/summary",
     "/decide", "/task", "/strategy", "/review",
     "/skills", "/employees", "/status", "/help", "/quit"],
    ignore_case=True,
    sentence=True,
)


def _get_history_path(data_dir: str) -> Path:
    """Return path for chat history file."""
    return Path(data_dir) / ".chat_history"


def _split_thinking_steps(raw: str) -> list[str]:
    """Split raw thinking content into steps by newlines, filter empty lines."""
    return [line.strip() for line in raw.strip().split("\n") if line.strip()]
