from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.core.harness.models import GateResult


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class PermissionLevel(str, Enum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


class Task(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    employee_id: UUID
    skill_id: UUID
    inputs: dict = {}
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = "queued"
    progress: float = 0.0
    result: dict | None = None
    error: str | None = None
    retry_count: int = 0
    created_at: datetime = Field(default_factory=_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None


class TaskStatus(BaseModel):
    task_id: UUID
    status: str
    progress: float
    message: str | None = None


class WorkflowExecution(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    workflow_id: UUID
    project_id: UUID
    status: Literal["running", "completed", "failed", "paused", "cancelled"] = "running"
    current_node_id: UUID | None = None
    completed_nodes: list[UUID] = []
    results: dict[str, dict] = {}
    gate_results: dict[str, GateResult] = {}
    created_at: datetime = Field(default_factory=_now)


class PermissionVerdict(BaseModel):
    allowed: bool
    level: PermissionLevel
    reason: str | None = None
    requires_approval: bool = False
