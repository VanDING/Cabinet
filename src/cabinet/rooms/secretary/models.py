from __future__ import annotations

from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from cabinet.rooms.decision.models import DecisionCard


class SecretaryLevel(str, Enum):
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"
    L4 = "L4"


class Greeting(BaseModel):
    captain_id: str
    message: str
    auto_processed_summary: str
    today_highlights: list[str]
    fallback: bool = False


class InteractionContext(BaseModel):
    captain_id: str
    project_id: UUID | None = None
    active_decisions: int = 0
    time_of_day: str = "morning"
    recent_interactions: list[str] = []
    channel: str = "terminal"


class SecretaryResponse(BaseModel):
    message: str
    level: SecretaryLevel
    decision_cards: list[DecisionCard] = []
    actions_taken: list[str] = []
    requires_captain: bool = False
    fallback: bool = False


class PendingSummary(BaseModel):
    captain_id: str
    urgent_count: int
    strategic_count: int
    execution_count: int
    evolution_count: int
    digest: str


class NotificationEvent(BaseModel):
    event_type: str
    severity: Literal["info", "warning", "critical"]
    source: str
    content: str
    related_decision_id: UUID | None = None


class NotificationResult(BaseModel):
    delivered: bool
    channel: str
    captain_should_see: bool


class FilterResult(BaseModel):
    should_present: bool
    urgency_override: Literal["red", "yellow", "blue", "white"] | None = None
    auto_action: str | None = None
    reason: str
