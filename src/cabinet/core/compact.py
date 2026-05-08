from __future__ import annotations

import logging
import re
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import yaml

from cabinet.core.prompt_cache import PromptCacheManager

logger = logging.getLogger(__name__)


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


# ── context compaction ──────────────────────────────────────


@dataclass
class SessionMemory:
    summary: str
    key_decisions: list[str] = field(default_factory=list)
    pending_tasks: list[str] = field(default_factory=list)
    updated_at: float = field(default_factory=time.monotonic)
    token_count: int = 0

    STALE_THRESHOLD: float = 300.0

    @property
    def is_fresh(self) -> bool:
        return (time.monotonic() - self.updated_at) < self.STALE_THRESHOLD

    @classmethod
    def load(cls, path: Path) -> SessionMemory | None:
        if not path.exists():
            return None
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not data:
            return None
        return cls(**data)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            yaml.dump(
                {
                    "summary": self.summary,
                    "key_decisions": self.key_decisions,
                    "pending_tasks": self.pending_tasks,
                    "updated_at": self.updated_at,
                    "token_count": self.token_count,
                },
                allow_unicode=True,
            ),
            encoding="utf-8",
        )


def format_history(history: list[dict], max_chars_per_msg: int = 500) -> str:
    lines = []
    for msg in history:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")[:max_chars_per_msg]
        lines.append(f"[{role}]: {content}")
    return "\n".join(lines)


async def summarize_with_llm(
    history: list[dict],
    gateway,
    model: str = "default",
) -> str:
    prompt = (
        "<analysis>\n"
        "Analyze the conversation history below. Identify:\n"
        "1. Key decisions made (with rationale)\n"
        "2. Pending tasks / unresolved items\n"
        "3. Important constraints or context that must be preserved\n"
        "4. Files/entities mentioned that may need to be referenced again\n"
        "</analysis>\n\n"
        "<summary>\n"
        "Condense the essential context from the conversation into a compact summary.\n"
        "Focus on WHAT was decided, WHAT is pending, and WHY.\n"
        "Omit conversational filler, greetings, and redundant explanations.\n"
        "</summary>\n\n"
        "## Conversation History\n"
        f"{format_history(history)}"
    )
    response = await gateway.complete(
        messages=[{"role": "user", "content": prompt}],
        model=model,
        temperature=0.3,
    )
    m = re.search(r"<summary>(.*?)</summary>", response.content, re.DOTALL)
    return m.group(1).strip() if m else response.content[:2000]


class ContextCompactor:
    def __init__(
        self,
        gateway,
        session_memory_path: Path | None = None,
        model: str = "default",
        max_failures: int = 3,
        prompt_cache_manager: PromptCacheManager | None = None,
    ):
        self._gateway = gateway
        self._session_path = session_memory_path
        self._model = model
        self._failure_count = 0
        self._max_failures = max_failures
        self._prompt_cache = prompt_cache_manager or PromptCacheManager()

    @property
    def prompt_cache(self) -> PromptCacheManager:
        return self._prompt_cache

    async def compact(
        self,
        history: list[dict],
        budget: TokenBudget,
    ) -> tuple[str, SessionMemory | None]:
        if self._failure_count >= self._max_failures:
            return "[Compaction suspended — circuit breaker open]", None

        if self._session_path:
            mem = SessionMemory.load(self._session_path)
            if mem and mem.is_fresh:
                return mem.summary, mem

        try:
            summary = await summarize_with_llm(history, self._gateway, self._model)
            mem = SessionMemory(
                summary=summary,
                token_count=budget.estimate_tokens(summary),
            )
            if self._session_path:
                mem.save(self._session_path)
            self._failure_count = 0
            return summary, mem
        except Exception as e:
            self._failure_count += 1
            logger.error(
                "Compaction failed (%d/%d): %s",
                self._failure_count,
                self._max_failures,
                e,
            )
            return f"[Compaction failed: {e}]", None
