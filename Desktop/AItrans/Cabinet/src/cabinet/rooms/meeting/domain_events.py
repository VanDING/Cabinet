from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.core.events.event_registry import register_event_type
from cabinet.rooms.meeting.models import ConvergenceResult, DissentItem, MeetingLevel


class SessionStarted(BaseModel):
    session_id: UUID
    project_id: UUID
    topic: str
    level: MeetingLevel
    participants: list[UUID]


class PerspectiveAdded(BaseModel):
    perspective_id: UUID
    session_id: UUID
    agent_id: UUID
    content: str
    round: int


class CrossValidationCompleted(BaseModel):
    session_id: UUID
    consensus: str
    dissent: list[DissentItem]
    unresolved: list[str]


class ConvergenceAchieved(BaseModel):
    session_id: UUID
    proposal_text: str
    confidence: float
    reasoning_summary: str
    convergence: ConvergenceResult
    rounds_used: int
    rumination_detected: bool


class ExpertWoken(BaseModel):
    session_id: UUID
    expert_id: UUID


class SessionClosed(BaseModel):
    session_id: UUID


register_event_type(SessionStarted)
register_event_type(PerspectiveAdded)
register_event_type(CrossValidationCompleted)
register_event_type(ConvergenceAchieved)
register_event_type(ExpertWoken)
register_event_type(SessionClosed)
