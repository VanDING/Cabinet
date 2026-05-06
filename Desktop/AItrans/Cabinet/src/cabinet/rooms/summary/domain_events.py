from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.core.events.event_registry import register_event_type
from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    ImprovementSuggestion,
    Insight,
    ReviewType,
)


class ReviewStarted(BaseModel):
    session_id: UUID
    project_id: UUID
    review_type: ReviewType


class InsightsGenerated(BaseModel):
    session_id: UUID
    insights: list[Insight]


class DecisionTreeBuilt(BaseModel):
    project_id: UUID
    tree: DecisionTree | None


class ImprovementsSuggested(BaseModel):
    session_id: UUID
    suggestions: list[ImprovementSuggestion]


class AuthorizationAudited(BaseModel):
    captain_id: str
    audit: AuthorizationAudit | None


register_event_type(ReviewStarted)
register_event_type(InsightsGenerated)
register_event_type(DecisionTreeBuilt)
register_event_type(ImprovementsSuggested)
register_event_type(AuthorizationAudited)
