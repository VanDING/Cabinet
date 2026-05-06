from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class DecisionType(str, Enum):
    STRATEGIC = "strategic"
    ACTION = "action"
    EXECUTION = "execution"
    ANOMALY = "anomaly"
    EVOLUTION = "evolution"


class DecisionStatus(str, Enum):
    PENDING = "pending"
    IN_REASONING = "in_reasoning"
    PROPOSAL_READY = "proposal_ready"
    APPROVED = "approved"
    REJECTED = "rejected"
    DELEGATED = "delegated"
    EXECUTED = "executed"
    FIRING = "firing"
    RESOLVED = "resolved"
    ESCAPED = "escaped"
    SUGGESTED = "suggested"
    ADOPTED = "adopted"
    DEFERRED = "deferred"
    DECLINED = "declined"
    ARCHIVED = "archived"
    BLUEPRINT_DRAFTED = "blueprint_drafted"
    MODIFIED = "modified"


class Decision(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    decision_type: DecisionType
    status: DecisionStatus = DecisionStatus.PENDING
    title: str
    description: str
    options: list[dict] = []
    chosen_option: dict | None = None
    captain_id: str
    source_event_id: UUID | None = None
    urgency: Literal["red", "yellow", "blue", "white"] = "yellow"
    created_at: datetime = Field(default_factory=_now)
    resolved_at: datetime | None = None
    immutable: bool = True
