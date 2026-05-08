from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    ImprovementSuggestion,
    Insight,
    ReviewSession,
    ReviewType,
)


@runtime_checkable
class SummaryRoom(Protocol):
    async def start_review(self, project_id: UUID, review_type: ReviewType) -> ReviewSession: ...
    async def generate_insights(self, session_id: UUID) -> list[Insight]: ...
    async def build_decision_tree(self, project_id: UUID) -> DecisionTree: ...
    async def suggest_improvements(self, session_id: UUID) -> list[ImprovementSuggestion]: ...
    async def audit_authorization_usage(self, captain_id: str) -> AuthorizationAudit: ...
