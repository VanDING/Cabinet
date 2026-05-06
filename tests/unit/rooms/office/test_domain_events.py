from uuid import uuid4

from cabinet.rooms.office.domain_events import (
    TaskCancelled,
    TaskFailed,
    TaskStatusChanged,
    TaskSubmitted,
    WorkflowCompleted,
    WorkflowNodeCompleted,
    WorkflowStarted,
)


def test_task_submitted_creation():
    event = TaskSubmitted(
        task_id=uuid4(), project_id=uuid4(),
        employee_id=uuid4(), skill_id=uuid4(), inputs={"key": "val"},
    )
    assert event.inputs == {"key": "val"}


def test_task_cancelled_creation():
    event = TaskCancelled(task_id=uuid4())
    assert event.task_id is not None


def test_task_status_changed_creation():
    event = TaskStatusChanged(
        task_id=uuid4(), old_status="queued",
        new_status="running", progress=0.5,
    )
    assert event.new_status == "running"


def test_task_failed_creation():
    event = TaskFailed(
        task_id=uuid4(), error_message="crash", retry_count=1,
    )
    assert event.error_message == "crash"


def test_workflow_started_creation():
    event = WorkflowStarted(
        execution_id=uuid4(), workflow_id=uuid4(), project_id=uuid4(),
    )
    assert event.workflow_id is not None


def test_workflow_node_completed_creation():
    event = WorkflowNodeCompleted(
        execution_id=uuid4(), node_id=uuid4(), result={"output": "done"},
    )
    assert event.result == {"output": "done"}


def test_workflow_completed_creation():
    event = WorkflowCompleted(
        execution_id=uuid4(), results={"node1": {"ok": True}},
    )
    assert "node1" in event.results
