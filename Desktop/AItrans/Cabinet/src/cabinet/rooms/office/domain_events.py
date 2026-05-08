from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.core.events.event_registry import register_event_type


class TaskSubmitted(BaseModel):
    task_id: UUID
    project_id: UUID
    employee_id: UUID
    skill_id: UUID
    inputs: dict


class TaskCancelled(BaseModel):
    task_id: UUID


class TaskStatusChanged(BaseModel):
    task_id: UUID
    old_status: str
    new_status: str
    progress: float


class TaskFailed(BaseModel):
    task_id: UUID
    error_message: str
    retry_count: int


class WorkflowStarted(BaseModel):
    execution_id: UUID
    workflow_id: UUID
    project_id: UUID


class WorkflowNodeCompleted(BaseModel):
    execution_id: UUID
    node_id: UUID
    result: dict


class WorkflowCompleted(BaseModel):
    execution_id: UUID
    results: dict[str, dict]


class WorkflowPaused(BaseModel):
    execution_id: UUID
    node_id: UUID
    decision_id: UUID
    reason: str


class WorkflowCancelled(BaseModel):
    execution_id: UUID
    reason: str | None = None


register_event_type(TaskSubmitted)
register_event_type(TaskCancelled)
register_event_type(TaskStatusChanged)
register_event_type(TaskFailed)
register_event_type(WorkflowStarted)
register_event_type(WorkflowNodeCompleted)
register_event_type(WorkflowCompleted)
register_event_type(WorkflowPaused)
register_event_type(WorkflowCancelled)
