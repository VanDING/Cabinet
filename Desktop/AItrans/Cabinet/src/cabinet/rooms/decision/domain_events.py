from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.core.events.event_registry import register_event_type
from cabinet.models.decisions import DecisionType


class DecisionSubmitted(BaseModel):
    decision_id: UUID
    project_id: UUID
    decision_type: DecisionType
    title: str
    description: str
    options: list[dict]
    captain_id: str
    source_event_id: UUID | None


class DecisionApproved(BaseModel):
    decision_id: UUID
    chosen_option: dict


class DecisionRejected(BaseModel):
    decision_id: UUID
    reason: str


class DecisionDelegated(BaseModel):
    decision_id: UUID
    delegate_to: str


class AuthorizationRuleSet(BaseModel):
    rule_id: UUID
    captain_id: str
    decision_type: DecisionType
    auto_approve: bool
    conditions: list[str]


class DecisionCascaded(BaseModel):
    parent_decision_id: UUID
    child_decision_ids: list[UUID]


register_event_type(DecisionSubmitted)
register_event_type(DecisionApproved)
register_event_type(DecisionRejected)
register_event_type(DecisionDelegated)
register_event_type(AuthorizationRuleSet)
register_event_type(DecisionCascaded)
