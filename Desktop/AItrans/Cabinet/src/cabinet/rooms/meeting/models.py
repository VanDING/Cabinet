from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.models.events import DeliberationProposal


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class MeetingLevel(str, Enum):
    FREE_DRAFT = "free_draft"
    MULTI_PARTY = "multi_party"
    EXPERT_HEARING = "expert_hearing"


class DeliberationSession(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    topic: str
    level: MeetingLevel
    participants: list[UUID]
    experts: list[UUID] = []
    status: Literal["open", "validating", "converging", "closed"] = "open"
    round: int = 1
    created_at: datetime = Field(default_factory=_now)


class Perspective(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    session_id: UUID
    agent_id: UUID
    content: str
    round: int
    created_at: datetime = Field(default_factory=_now)


class DissentItem(BaseModel):
    agent_id: UUID
    content: str
    reasoning: str


class ConvergenceResult(BaseModel):
    consensus: str
    dissent: list[DissentItem]
    unresolved: list[str]


class DeliberationResult(BaseModel):
    session_id: UUID
    proposal_text: str
    confidence: float
    reasoning_summary: str
    convergence: ConvergenceResult
    rounds_used: int
    rumination_detected: bool


class DeliberationOutput(BaseModel):
    session_id: UUID
    proposal: DeliberationResult
    event_payload: DeliberationProposal = None

    def model_post_init(self, __context: object) -> None:
        if self.event_payload is None:
            self.event_payload = DeliberationProposal(
                proposal_text=self.proposal.proposal_text,
                confidence=self.proposal.confidence,
                reasoning_summary=self.proposal.reasoning_summary,
            )
