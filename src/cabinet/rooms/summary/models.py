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


class SimilarCase(BaseModel):
    decision_id: UUID
    title: str
    decision_type: str
    chosen_option: dict | None = None
    outcome: str
    result_summary: str
    similarity_score: float


class RiskPattern(BaseModel):
    pattern_name: str
    description: str
    matched_conditions: list[str] = []
    historical_occurrence_count: int
    severity: Literal["warning", "critical"]


class ScenarioResult(BaseModel):
    scenario_type: Literal["optimistic", "pessimistic", "baseline"]
    description: str
    key_assumptions: list[str] = []
    expected_outcome: str
    risks: list[str] = []
    probability: float


class RehearsalReport(BaseModel):
    decision_id: UUID
    similar_cases: list[SimilarCase] = []
    matched_risk_patterns: list[RiskPattern] = []
    optimistic_scenario: ScenarioResult
    pessimistic_scenario: ScenarioResult
    baseline_scenario: ScenarioResult
    risk_level: Literal["low", "medium", "high", "critical"]
    recommendations: list[str] = []


class MemoryMatch(BaseModel):
    memory_id: UUID
    content: str
    source: str
    relevance_score: float
    project_context: str


class AutonomyRecommendation(BaseModel):
    scenario: str
    current_level: str
    total_decisions: int
    correct_decisions: int
    recommended_level: str
    reasoning: str


class AutonomyAudit(BaseModel):
    captain_id: str
    period: str
    l0_total: int = 0
    l0_correct: int = 0
    l0_correct_rate: float = 0.0
    l1_total: int = 0
    l1_correct: int = 0
    l1_correct_rate: float = 0.0
    expand_autonomy_to: list[AutonomyRecommendation] = []
    restrict_autonomy_from: list[AutonomyRecommendation] = []
