from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class DenialTracker:
    max_consecutive: int = 3
    max_total: int = 20
    consecutive: int = 0
    total: int = 0
    recent_denials: list[dict] = field(default_factory=list)
    _max_recent: int = 50

    def record_denial(self, tool_name: str, tool_input: str = "") -> None:
        self.consecutive += 1
        self.total += 1
        self.recent_denials.append({
            "tool": tool_name,
            "input": tool_input[:200],
        })
        if len(self.recent_denials) > self._max_recent:
            self.recent_denials = self.recent_denials[-self._max_recent:]

        logger.warning(
            "Denial #%d (consecutive=%d, total=%d) for %s",
            self.total, self.consecutive, self.total, tool_name,
        )

    def record_success(self, tool_name: str) -> None:
        if self.consecutive > 0:
            logger.info(
                "Consecutive denial streak broken by %s (was %d)",
                tool_name, self.consecutive,
            )
        self.consecutive = 0

    def is_circuit_open(self) -> bool:
        if self.consecutive >= self.max_consecutive:
            logger.error(
                "CIRCUIT BREAKER OPEN: %d consecutive denials",
                self.consecutive,
            )
            return True
        if self.total >= self.max_total:
            logger.error(
                "CIRCUIT BREAKER OPEN: %d total denials",
                self.total,
            )
            return True
        return False

    def reset(self) -> None:
        self.consecutive = 0
        self.total = 0
        self.recent_denials.clear()
        logger.info("DenialTracker reset")
