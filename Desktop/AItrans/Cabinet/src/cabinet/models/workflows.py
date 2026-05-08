from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Annotated, Literal, Union
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class RetryPolicy(BaseModel):
    max_retries: int = 3
    backoff_base: float = 1.0
    backoff_max: float = 60.0
    retryable_errors: list[str] = []


@dataclass
class GraphResult:
    completed: bool = False
    paused: bool = False
    failed: bool = False
    cancelled: bool = False
    output: dict = field(default_factory=dict)
    pause_info: dict | None = None
    failed_node_id: str | None = None
    error: str | None = None


class NodeExecutionRecord(BaseModel):
    node_id: UUID
    node_name: str
    status: Literal["pending", "running", "completed", "failed", "paused", "skipped", "cancelled"] = "pending"
    started_at: str | None = None
    completed_at: str | None = None
    duration_ms: float | None = None
    input_data: dict | None = None
    output_data: dict | None = None
    error: str | None = None
    retry_count: int = 0


class TimelineEvent(BaseModel):
    event: str
    node_id: str | None = None
    timestamp: str
    details: dict | None = None


class TriggerNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["trigger"] = "trigger"
    name: str = "trigger"
    trigger_type: str
    condition: str | None = None


class SkillNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["skill"] = "skill"
    name: str = "skill"
    skill_id: UUID
    employee_id: UUID
    inputs: dict = {}
    requires_knowledge: list[UUID] = []
    retry_policy: RetryPolicy | None = None


class ConditionNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["condition"] = "condition"
    name: str = "condition"
    expression: str
    true_next: UUID
    false_next: UUID


class LoopNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["loop"] = "loop"
    name: str = "loop"
    loop_type: Literal["count", "condition", "iterator"] = "count"
    max_iterations: int = 100
    iterator_expr: str = ""
    condition_expr: str = ""
    body_entry_id: UUID
    body_exit_id: UUID | None = None
    break_on_error: bool = True
    retry_policy: RetryPolicy | None = None


class HumanApprovalNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["human_approval"] = "human_approval"
    name: str = "human_approval"
    decision_type: str
    message_template: str | None = None
    timeout: int | None = None          # NEW: timeout in seconds
    timeout_strategy: str = "escalate"   # NEW: escalate | skip | default


class HumanNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["human"] = "human"
    name: str = "human"
    employee_id: UUID
    input_protocol: dict | None = None
    output_protocol: dict | None = None
    timeout: int | None = None
    timeout_strategy: str = "escalate"


class ParallelNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["parallel"] = "parallel"
    name: str = "parallel"
    branch_node_ids: list[UUID]
    aggregation_strategy: str = "wait_all"


class EndNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["end"] = "end"
    name: str = "end"
    output_mapping: dict = {}


WorkflowNode = Annotated[
    Union[
        TriggerNode,
        SkillNode,
        ConditionNode,
        LoopNode,
        HumanApprovalNode,
        HumanNode,
        ParallelNode,
        EndNode,
    ],
    Field(discriminator="kind"),
]


class WorkflowEdge(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    source_node_id: UUID
    target_node_id: UUID
    condition: str | None = None


class Workflow(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    project_id: UUID
    name: str
    kind: Literal["team", "composite_skill"]
    nodes: list[Annotated[WorkflowNode, Field(discriminator="kind")]]
    edges: list[WorkflowEdge]
    version: int = 1
    created_at: datetime = Field(default_factory=_now)
