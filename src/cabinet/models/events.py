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


class MessageType(str, Enum):
    DELIBERATION_PROPOSAL = "deliberation.proposal"
    DELIBERATION_DISSENT = "deliberation.dissent"
    STRATEGY_DECODE_RESULT = "strategy.decode_result"
    DECISION_REQUEST = "decision.request"
    DECISION_RESPONSE = "decision.response"
    TASK_ORDER = "task.order"
    TASK_STATUS_UPDATE = "task.status_update"
    TASK_FAILURE = "task.failure"
    SUMMARY_INSIGHT = "summary.insight"
    SUMMARY_REVIEW_REQUEST = "summary.review_request"
    HARNESS_EVALUATION_RESULT = "harness.evaluation_result"
    SECRETARY_NOTIFICATION = "secretary.notification"


class MessageEnvelope(BaseModel):
    message_id: UUID = Field(default_factory=_uuid)
    correlation_id: UUID = Field(default_factory=_uuid)
    causation_id: UUID = Field(default_factory=_uuid)
    sender: str
    recipients: list[str]
    message_type: str
    timestamp: datetime = Field(default_factory=_now)
    status: Literal["active", "processed", "archived"] = "active"
    payload: dict = {}


class DeliberationProposal(BaseModel):
    proposal_text: str
    confidence: float = 0.0
    reasoning_summary: str = ""


class DeliberationDissent(BaseModel):
    dissent_text: str
    source_agent_id: UUID


class StrategyDecodeResult(BaseModel):
    action_domains: list[str] = []
    constraints: list[str] = []
    success_criteria: list[str] = []


class DecisionRequest(BaseModel):
    decision_id: UUID
    decision_type: str
    title: str
    options: list[dict] = []


class DecisionResponse(BaseModel):
    decision_id: UUID
    chosen_option: dict
    captain_id: str


class TaskOrder(BaseModel):
    employee_id: UUID
    skill_id: UUID
    inputs: dict = {}


class TaskStatusUpdate(BaseModel):
    task_id: UUID
    status: str
    progress: float = 0.0


class TaskFailure(BaseModel):
    task_id: UUID
    error_message: str
    retry_count: int = 0


class SummaryInsight(BaseModel):
    insight_type: str
    content: str


class SummaryReviewRequest(BaseModel):
    project_id: UUID
    review_type: str


class HarnessEvaluationResult(BaseModel):
    passed: bool
    evaluator_id: UUID
    notes: str = ""


class SecretaryNotification(BaseModel):
    captain_id: str
    notification_type: str
    content: str
    severity: Literal["info", "warning", "critical"]
    related_decision_id: UUID | None = None
