from __future__ import annotations

import uuid
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.models.decisions import Decision, DecisionType


def _uuid() -> UUID:
    return uuid.uuid4()


class DecisionCard(BaseModel):
    decision: Decision
    urgency_color: Literal["red", "yellow", "blue", "white"]
    summary: str
    options_summary: list[str]
    source_room: str
    created_ago: str


class DecisionDashboard(BaseModel):
    project_id: UUID
    red_cards: list[DecisionCard]
    yellow_cards: list[DecisionCard]
    blue_cards: list[DecisionCard]
    white_cards: list[DecisionCard]
    total_pending: int


class AuthorizationRule(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    captain_id: str
    decision_type: DecisionType
    auto_approve: bool = False
    conditions: list[str] = []
    budget_threshold: float | None = None
    notify_only: bool = False


class AuthorizationVerdict(BaseModel):
    auto_process: bool
    requires_captain: bool
    reason: str
    matched_rule: UUID | None = None
