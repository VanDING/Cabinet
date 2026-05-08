from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cabinet.core.user.profile_manager import UserProfileManager

logger = logging.getLogger(__name__)


@dataclass
class UserProfileInjector:
    profile_manager: "UserProfileManager"
    max_tokens: int = 1000
    cache_ttl: float = 300.0

    def __post_init__(self):
        self._cache: dict[str, tuple[float, str]] = {}

    def build_context(self, captain_id: str) -> str:
        now = time.monotonic()
        cached = self._cache.get(captain_id)
        if cached and (now - cached[0]) < self.cache_ttl:
            return cached[1]

        profile = self.profile_manager.build_profile(captain_id)
        context = profile.format_for_prompt()

        max_chars = self.max_tokens * 4
        if len(context) > max_chars:
            context = context[:max_chars]

        self._cache[captain_id] = (now, context)
        logger.debug("Built user profile context: %d chars for %s", len(context), captain_id)
        return context

    def format_as_system_prompt(self, captain_id: str) -> str:
        context = self.build_context(captain_id)
        if not context:
            return ""
        return (
            "<user-profile>\n"
            "The following information is known about the user from prior interactions:\n\n"
            f"{context}\n\n"
            "Use this context to tailor your responses to the user's background, preferences, and current project.\n"
            "</user-profile>"
        )

    def invalidate_cache(self, captain_id: str | None = None) -> None:
        if captain_id is None:
            self._cache.clear()
        else:
            self._cache.pop(captain_id, None)
