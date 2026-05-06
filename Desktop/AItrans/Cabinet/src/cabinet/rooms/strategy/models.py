from __future__ import annotations

import uuid
from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class ActionDomain(BaseModel):
    name: str
    goal: str
    constraints: list[str] = []
    success_criteria: list[str] = []
    dependencies: list[str] = []
    risk_checkpoints: list[str] = []


class ActionBlueprint(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    source_proposal_id: UUID
    domains: list[ActionDomain]
    execution_order: list[list[str]]
    global_constraints: list[str] = []
    created_at: datetime = Field(default_factory=_now)


class BlueprintValidation(BaseModel):
    valid: bool
    issues: list[str] = []
    domain_count_ok: bool
    dependencies_resolved: bool
    criteria_measurable: bool


class DecodeContext(BaseModel):
    project_id: UUID
    captain_id: str
    existing_constraints: list[str] = []
