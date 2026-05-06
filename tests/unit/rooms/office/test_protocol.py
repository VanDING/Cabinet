import uuid

import pytest

from cabinet.models.events import TaskOrder
from cabinet.rooms.office.models import (
    PermissionLevel,
    PermissionVerdict,
    Task,
    TaskStatus,
    WorkflowExecution,
)
from cabinet.rooms.office.protocol import OfficeScheduler


def test_office_scheduler_protocol_runtime_checkable():
    class MockOffice:
        async def submit_task(self, order):
            return Task(
                project_id=uuid.uuid4(),
                employee_id=order.employee_id,
                skill_id=order.skill_id,
                inputs=order.inputs,
            )

        async def cancel_task(self, task_id):
            pass

        async def get_task_status(self, task_id):
            return TaskStatus(task_id=task_id, status="running", progress=0.5)

        async def list_active_tasks(self, project_id):
            return []

        async def execute_workflow(self, workflow_id, inputs):
            return WorkflowExecution(workflow_id=workflow_id, project_id=uuid.uuid4())

        async def check_permission(self, employee_id, action):
            return PermissionVerdict(allowed=True, level=PermissionLevel.L3)

    mock = MockOffice()
    assert isinstance(mock, OfficeScheduler)


@pytest.mark.asyncio
async def test_office_submit_task_contract():
    class MockOffice:
        async def submit_task(self, order):
            return Task(
                project_id=uuid.uuid4(),
                employee_id=order.employee_id,
                skill_id=order.skill_id,
                inputs=order.inputs,
            )

        async def cancel_task(self, task_id):
            pass

        async def get_task_status(self, task_id):
            return TaskStatus(task_id=task_id, status="queued", progress=0.0)

        async def list_active_tasks(self, project_id):
            return []

        async def execute_workflow(self, workflow_id, inputs):
            return WorkflowExecution(workflow_id=workflow_id, project_id=uuid.uuid4())

        async def check_permission(self, employee_id, action):
            return PermissionVerdict(allowed=True, level=PermissionLevel.L3)

    office = MockOffice()
    order = TaskOrder(employee_id=uuid.uuid4(), skill_id=uuid.uuid4(), inputs={"key": "value"})
    task = await office.submit_task(order)
    assert isinstance(task, Task)
    assert task.status == "queued"


@pytest.mark.asyncio
async def test_office_check_permission_contract():
    class MockOffice:
        async def submit_task(self, order):
            return Task(project_id=uuid.uuid4(), employee_id=order.employee_id, skill_id=order.skill_id)

        async def cancel_task(self, task_id):
            pass

        async def get_task_status(self, task_id):
            return TaskStatus(task_id=task_id, status="queued", progress=0.0)

        async def list_active_tasks(self, project_id):
            return []

        async def execute_workflow(self, workflow_id, inputs):
            return WorkflowExecution(workflow_id=workflow_id, project_id=uuid.uuid4())

        async def check_permission(self, employee_id, action):
            if action == "send_email":
                return PermissionVerdict(allowed=True, level=PermissionLevel.L2, requires_approval=False)
            return PermissionVerdict(allowed=False, level=PermissionLevel.L0, reason="Forbidden")

    office = MockOffice()
    verdict = await office.check_permission(uuid.uuid4(), "send_email")
    assert isinstance(verdict, PermissionVerdict)
    assert verdict.allowed is True
    assert verdict.level == PermissionLevel.L2
