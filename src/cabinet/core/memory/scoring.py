from __future__ import annotations

import math
import time as _time
from dataclasses import dataclass

from cabinet.models.primitives import MemoryItem


@dataclass
class MemoryScore:
    item: MemoryItem
    score: float


class MemoryScorer:
    """Score memories by semantic relevance (0.5) + recency (0.3) + access frequency (0.2)."""
    HALF_LIFE: float = 7 * 86400
    MIN_SCORE: float = 0.3

    def score(self, items: list[MemoryItem], query: str,
              current_time: float | None = None) -> list[MemoryScore]:
        if not items:
            return []

        now = current_time if current_time is not None else _time.time()
        scored = []
        for item in items:
            semantic = self._semantic_sim(item.content, query)
            if item.accessed_at is not None:
                recency = self._recency(item.accessed_at.timestamp(), now)
            else:
                recency = 0.0
            freq = self._access_freq(item)
            score = semantic * 0.5 + recency * 0.3 + freq * 0.2
            scored.append(MemoryScore(item=item, score=round(score, 4)))
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored

    def _semantic_sim(self, content: str, query: str) -> float:
        if not query:
            return 0.5
        c_words = set(content.lower().split())
        q_words = set(query.lower().split())
        intersection = c_words & q_words
        union = c_words | q_words
        return len(intersection) / max(len(union), 1)

    def _recency(self, access_ts: float, now: float) -> float:
        delta = max(0, now - access_ts)
        return math.exp(-delta / self.HALF_LIFE)

    def _access_freq(self, item: MemoryItem) -> float:
        count = 1
        if item.metadata:
            count = item.metadata.get("access_count", 1)
        return min(float(count) / 10.0, 1.0)
