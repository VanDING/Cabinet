from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.models.events import TaskOrder
from cabinet.rooms.office.models import (
    PermissionVerdict,
    Task,
    TaskStatus,
    WorkflowExecution,
)


@runtime_checkable
class OfficeScheduler(Protocol):
    async def submit_task(self, order: TaskOrder) -> Task: ...
    async def cancel_task(self, task_id: UUID) -> None: ...
    async def get_task_status(self, task_id: UUID) -> TaskStatus: ...
    async def list_active_tasks(self, project_id: UUID) -> list[Task]: ...
    async def execute_workflow(self, workflow_id: UUID, inputs: dict) -> WorkflowExecution: ...
    async def check_permission(self, employee_id: UUID, action: str) -> PermissionVerdict: ...
