from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4


@dataclass
class TokenBudget:
    model_max_tokens: int = 200_000
    reserve_ratio: float = 0.15

    @property
    def max_input_tokens(self) -> int:
        return int(self.model_max_tokens * (1 - self.reserve_ratio))

    def estimate_tokens(self, text: str) -> int:
        return max(1, len(text) // 4)

    def estimate_messages(self, messages: list[dict]) -> int:
        return sum(self.estimate_tokens(m.get("content", "")) for m in messages)

    def fit_messages(
        self,
        system_messages: list[dict],
        history: list[dict],
        new_message: dict,
    ) -> list[dict]:
        fixed_tokens = self.estimate_messages(system_messages)
        fixed_tokens += self.estimate_tokens(new_message.get("content", ""))
        budget = self.max_input_tokens - fixed_tokens

        kept: list[dict] = []
        remaining = budget
        for msg in reversed(history):
            cost = self.estimate_tokens(msg.get("content", ""))
            if remaining - cost < 0:
                break
            kept.insert(0, msg)
            remaining -= cost

        return system_messages + kept + [new_message]


MODEL_TOKEN_LIMITS: dict[str, int] = {
    "deepseek/deepseek-v4-pro": 200_000,
    "deepseek/deepseek-v4-flash": 128_000,
    "openai/gpt-4o": 128_000,
    "anthropic/claude-sonnet-4-6": 200_000,
    "anthropic/claude-opus-4-7": 200_000,
    "ollama/llama3": 8_192,
}

# ── tool result compaction ──────────────────────────────────

TOOL_RESULT_MAX_CHARS = 50_000
TOOL_PREVIEW_CHARS = 2_000

_WRITE_TOOLS = {"Write", "Edit", "NotebookEdit"}


def compact_tool_result(
    content: str,
    tool_name: str,
    cache_dir: str | None = None,
) -> tuple[str, str | None]:
    if len(content) <= TOOL_RESULT_MAX_CHARS:
        return content, None

    if tool_name in _WRITE_TOOLS:
        return f"[Write result: {len(content)} chars, content written to target]", None

    cache_path = Path(cache_dir or tempfile.gettempdir()) / "cabinet" / "tool_results"
    cache_path.mkdir(parents=True, exist_ok=True)

    filepath = cache_path / f"tool_{tool_name}_{uuid4().hex}.txt"
    filepath.write_text(content, encoding="utf-8")

    preview = content[:TOOL_PREVIEW_CHARS]
    return (
        f"{preview}\n\n...[truncated: {len(content)} chars total, full content at {filepath}]",
        str(filepath),
    )
