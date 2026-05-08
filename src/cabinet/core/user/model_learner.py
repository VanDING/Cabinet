from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

from cabinet.core.user.models import MemoryType, MemoryEntry

if TYPE_CHECKING:
    from cabinet.core.user.profile_manager import UserProfileManager

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.6

CORRECTION_PATTERNS = [
    re.compile(r"\b(no|don't|never|stop|avoid)\b.*\b(do|use|write|say|call)\b", re.IGNORECASE),
    re.compile(r"not\s+that", re.IGNORECASE),
    re.compile(r"(wrong|incorrect|bad)\s+(approach|idea|way)", re.IGNORECASE),
]

CONFIRMATION_PATTERNS = [
    re.compile(r"\b(yes|exactly|right|correct|perfect|good|great)\b", re.IGNORECASE),
    re.compile(r"keep\s+(doing|using|writing)", re.IGNORECASE),
]

REMEMBER_PATTERNS = [
    re.compile(r"\b(remember|note|save)\s+(that|this)\b", re.IGNORECASE),
    re.compile(r"\bstore\s+this\b", re.IGNORECASE),
]

ROLE_PATTERNS = [
    re.compile(
        r"i('m| am)\s+a\s+(\w+[\s\w]*(?:engineer|developer|scientist|designer|manager|analyst|architect))",
        re.IGNORECASE,
    ),
]


@dataclass
class ConversationObservation:
    memory_type: MemoryType
    name: str
    content: str
    confidence: float = 0.7
    source_message: str = ""


class UserModelLearner:
    def __init__(
        self,
        profile_manager: "UserProfileManager",
        confidence_threshold: float = CONFIDENCE_THRESHOLD,
    ):
        self.manager = profile_manager
        self._threshold = confidence_threshold

    def analyze_interaction(
        self, user_message: str, assistant_response: str
    ) -> ConversationObservation | None:
        msg = user_message.strip()

        obs = self._detect_remember(msg)
        if obs:
            return obs

        obs = self._detect_role(msg)
        if obs:
            return obs

        obs = self._detect_correction(msg)
        if obs:
            return obs

        obs = self._detect_confirmation(msg)
        if obs:
            return obs

        return None

    def save_observation(self, obs: ConversationObservation) -> bool:
        if obs.confidence < self._threshold:
            logger.debug("Skipping low-confidence observation: %s (%.2f)", obs.name, obs.confidence)
            return False

        entry = MemoryEntry(
            memory_type=obs.memory_type,
            name=obs.name,
            content=obs.content,
        )
        self.manager.save(entry)
        logger.info(
            "Learned: [%s] %s (confidence=%.2f)", obs.memory_type.value, obs.name, obs.confidence
        )
        return True

    def _detect_remember(self, msg: str) -> ConversationObservation | None:
        for pattern in REMEMBER_PATTERNS:
            if pattern.search(msg):
                content = re.sub(
                    r"(?i)(please\s+)?remember\s+(that|this|to)\s*[:\-]?\s*", "", msg
                ).strip()
                return ConversationObservation(
                    memory_type=MemoryType.REFERENCE,
                    name="Remembered Fact",
                    content=content,
                    confidence=0.9,
                )
        return None

    def _detect_role(self, msg: str) -> ConversationObservation | None:
        for pattern in ROLE_PATTERNS:
            m = pattern.search(msg)
            if m:
                role = m.group(2).strip()
                return ConversationObservation(
                    memory_type=MemoryType.USER,
                    name="User Role",
                    content=f"User is a {role}. {msg}",
                    confidence=0.85,
                )
        return None

    def _detect_correction(self, msg: str) -> ConversationObservation | None:
        for pattern in CORRECTION_PATTERNS:
            if pattern.search(msg):
                return ConversationObservation(
                    memory_type=MemoryType.FEEDBACK,
                    name="Work Preference",
                    content=msg,
                    confidence=0.75,
                )
        return None

    def _detect_confirmation(self, msg: str) -> ConversationObservation | None:
        for pattern in CONFIRMATION_PATTERNS:
            if pattern.search(msg):
                return ConversationObservation(
                    memory_type=MemoryType.FEEDBACK,
                    name="Preference Confirmed",
                    content=msg,
                    confidence=0.65,
                )
        return None
