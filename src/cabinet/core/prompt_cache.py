from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

STATIC_DYNAMIC_BOUNDARY = "---STATIC_ABOVE_/_DYNAMIC_BELOW---"


@dataclass
class PromptCacheStats:
    hits: int = 0
    misses: int = 0
    last_hit_at: float = 0.0
    last_miss_at: float = 0.0

    def record_hit(self) -> None:
        self.hits += 1
        self.last_hit_at = time.monotonic()

    def record_miss(self) -> None:
        self.misses += 1
        self.last_miss_at = time.monotonic()

    @property
    def total_requests(self) -> int:
        return self.hits + self.misses

    @property
    def hit_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return self.hits / self.total_requests

    def reset(self) -> None:
        self.hits = 0
        self.misses = 0


@dataclass
class PromptCacheManager:
    static_prompt: str = ""
    boundary: str = STATIC_DYNAMIC_BOUNDARY
    cache_version: int = 1
    stats: PromptCacheStats = field(default_factory=PromptCacheStats)

    def build_prompt_parts(self, dynamic_context: str = "") -> dict[str, str]:
        if self.boundary not in self.static_prompt:
            return {
                "static": "",
                "dynamic": self.static_prompt + "\n" + dynamic_context,
            }

        parts = self.static_prompt.split(self.boundary, 1)
        static = parts[0].strip()
        trailing = parts[1].strip() if len(parts) > 1 else ""
        dynamic = (trailing + "\n" + dynamic_context).strip()

        logger.debug(
            "Prompt cache split: static=%d chars, dynamic=%d chars",
            len(static), len(dynamic),
        )
        return {"static": static, "dynamic": dynamic}

    def build_anthropic_system(
        self,
        dynamic_context: str = "",
        extra_systems: list[dict] | None = None,
    ) -> list[dict]:
        parts = self.build_prompt_parts(dynamic_context)
        systems: list[dict] = []

        if parts["static"]:
            systems.append({
                "type": "text",
                "text": parts["static"],
                "cache_control": {"type": "ephemeral"},
            })
        if parts["dynamic"]:
            systems.append({
                "type": "text",
                "text": parts["dynamic"],
            })
        for extra in (extra_systems or []):
            systems.append(extra)

        return systems

    def fingerprint(self) -> str:
        return hashlib.sha256(self.static_prompt.encode()).hexdigest()[:16]

    @staticmethod
    def estimate_cache_savings(
        static_chars: int, cost_per_million_input: float = 3.0
    ) -> float:
        static_tokens = max(1, static_chars // 4)
        uncached_cost = (static_tokens / 1_000_000) * cost_per_million_input
        cached_cost = uncached_cost * 0.10
        return uncached_cost - cached_cost
