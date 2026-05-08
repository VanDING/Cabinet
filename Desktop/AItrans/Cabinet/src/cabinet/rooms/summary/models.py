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


class ReviewType(str, Enum):
    PROJECT_REVIEW = "project_review"
    ORG_OPTIMIZATION = "org_optimization"
    CAPTAIN_INSIGHT = "captain_insight"


class ReviewSession(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    review_type: ReviewType
    status: Literal["in_progress", "completed"] = "in_progress"
    created_at: datetime = Field(default_factory=_now)
    completed_at: datetime | None = None


class Insight(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    session_id: UUID
    insight_type: str
    content: str
    confidence: float
    auto_applicable: bool
    requires_captain: bool


class DecisionTreeNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    node_type: Literal["root", "branch", "decision", "execution", "anomaly", "external"]
    label: str
    decision_id: UUID | None = None
    outcome: Literal["approved", "rejected", "completed", "failed"] | None = None
    children: list[UUID] = []
    metadata: dict = {}


class DecisionTree(BaseModel):
    project_id: UUID
    root_node_id: UUID
    nodes: dict[UUID, DecisionTreeNode]


class ImprovementSuggestion(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    session_id: UUID
    category: Literal["skill", "workflow", "authorization", "knowledge"]
    description: str
    impact: Literal["low", "medium", "high"]
    effort: Literal["low", "medium", "high"]
    auto_applicable: bool


class AuthorizationAudit(BaseModel):
    captain_id: str
    period: str
    total_decisions: int
    manually_approved: int
    could_auto_process: int
    suggestion: str | None = None
