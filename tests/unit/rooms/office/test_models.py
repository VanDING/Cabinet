import uuid

from cabinet.core.harness.models import GateResult
from cabinet.rooms.office.models import (
    PermissionLevel,
    PermissionVerdict,
    Task,
    TaskStatus,
    WorkflowExecution,
)


def test_permission_level_values():
    assert PermissionLevel.L0 == "L0"
    assert PermissionLevel.L1 == "L1"
    assert PermissionLevel.L2 == "L2"
    assert PermissionLevel.L3 == "L3"


def test_task_creation():
    proj_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    skill_id = uuid.uuid4()
    task = Task(
        project_id=proj_id,
        employee_id=emp_id,
        skill_id=skill_id,
        inputs={"text": "hello"},
    )
    assert task.status == "queued"
    assert task.progress == 0.0
    assert task.result is None
    assert task.retry_count == 0
    assert task.started_at is None


def test_task_completed():
    proj_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    skill_id = uuid.uuid4()
    task = Task(
        project_id=proj_id,
        employee_id=emp_id,
        skill_id=skill_id,
        status="completed",
        progress=1.0,
        result={"output": "done"},
    )
    assert task.status == "completed"
    assert task.progress == 1.0
    assert task.result == {"output": "done"}


def test_task_failed():
    proj_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    skill_id = uuid.uuid4()
    task = Task(
        project_id=proj_id,
        employee_id=emp_id,
        skill_id=skill_id,
        status="failed",
        error="Connection timeout",
        retry_count=2,
    )
    assert task.status == "failed"
    assert task.error == "Connection timeout"
    assert task.retry_count == 2


def test_task_status():
    task_id = uuid.uuid4()
    status = TaskStatus(
        task_id=task_id,
        status="running",
        progress=0.5,
        message="Processing step 3 of 6",
    )
    assert status.progress == 0.5
    assert status.message == "Processing step 3 of 6"


def test_workflow_execution():
    proj_id = uuid.uuid4()
    wf_id = uuid.uuid4()
    node_id = uuid.uuid4()
    execution = WorkflowExecution(
        workflow_id=wf_id,
        project_id=proj_id,
        status="running",
        current_node_id=node_id,
        completed_nodes=[],
    )
    assert execution.status == "running"
    assert execution.current_node_id == node_id
    assert execution.results == {}
    assert execution.gate_results == {}


def test_workflow_execution_with_results():
    proj_id = uuid.uuid4()
    wf_id = uuid.uuid4()
    node_a = uuid.uuid4()
    node_b = uuid.uuid4()
    gate = GateResult(passed=True)
    execution = WorkflowExecution(
        workflow_id=wf_id,
        project_id=proj_id,
        status="completed",
        completed_nodes=[node_a, node_b],
        results={str(node_a): {"output": "a"}, str(node_b): {"output": "b"}},
        gate_results={str(node_b): gate},
    )
    assert execution.status == "completed"
    assert len(execution.completed_nodes) == 2
    assert execution.gate_results[str(node_b)].passed is True


def test_permission_verdict_allowed():
    verdict = PermissionVerdict(
        allowed=True,
        level=PermissionLevel.L3,
        requires_approval=False,
    )
    assert verdict.allowed is True
    assert verdict.level == PermissionLevel.L3
    assert verdict.reason is None


def test_permission_verdict_denied():
    verdict = PermissionVerdict(
        allowed=False,
        level=PermissionLevel.L0,
        reason="Operation requires Captain",
        requires_approval=False,
    )
    assert verdict.allowed is False
    assert verdict.level == PermissionLevel.L0
    assert verdict.requires_approval is False
