import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.models.events import TaskOrder
from cabinet.rooms.office.domain_events import TaskFailed
from cabinet.rooms.office.models import PermissionVerdict, TaskStatus
from cabinet.rooms.office.service import OfficeSchedulerService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("office")
    return OfficeSchedulerService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_submit_task(service, publisher):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"x": 1})
    task = await service.submit_task(order)
    assert task.status == "queued"
    assert task.employee_id == order.employee_id


@pytest.mark.asyncio
async def test_cancel_task(service, publisher):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    publisher.published.clear()
    await service.cancel_task(task.id)
    assert service._tasks[task.id].status == "cancelled"
    msg_types = [mt for _, mt, _, _ in publisher.published]
    assert "task.status_update" in msg_types


@pytest.mark.asyncio
async def test_get_task_status(service):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    status = await service.get_task_status(task.id)
    assert isinstance(status, TaskStatus)
    assert status.status == "queued"


@pytest.mark.asyncio
async def test_list_active_tasks(service):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"p": uuid4()})
    await service.submit_task(order)
    pid = list(service._tasks.values())[0].project_id
    active = await service.list_active_tasks(pid)
    assert len(active) >= 1


@pytest.mark.asyncio
async def test_execute_workflow(service):
    wf_id = uuid4()
    execution = await service.execute_workflow(wf_id, {"input": "data"})
    assert execution.status in ("running", "completed")
    assert execution.workflow_id == wf_id


@pytest.mark.asyncio
async def test_check_permission(service):
    verdict = await service.check_permission(uuid4(), "read")
    assert isinstance(verdict, PermissionVerdict)


@pytest.mark.asyncio
async def test_task_failure_cross_room_event(service):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    cross = service._apply_event(TaskFailed(
        task_id=task.id, error_message="crash", retry_count=0,
    ))
    msg_types = [mt for mt, _, _ in cross]
    assert "task.failure" in msg_types


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    new_service = OfficeSchedulerService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert task.id in new_service._tasks


@pytest.mark.asyncio
async def test_execute_workflow_with_verification_gate(publisher):
    from cabinet.core.harness.models import GateResult
    from uuid import UUID

    checked_nodes: list[UUID] = []

    class MockVerificationGate:
        async def check(self, node_id: UUID, context: dict) -> GateResult:
            checked_nodes.append(node_id)
            return GateResult(passed=True)

    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), verification_gate=MockVerificationGate())
    execution = await service.execute_workflow(uuid4(), {"input": "data"})
    assert len(checked_nodes) == 1
    assert execution.status in ("running", "completed")


@pytest.mark.asyncio
async def test_execute_workflow_gate_failed_records_gate_result(publisher):
    from cabinet.core.harness.models import GateResult
    from uuid import UUID

    class FailingVerificationGate:
        async def check(self, node_id: UUID, context: dict) -> GateResult:
            return GateResult(passed=False, reason="Quality below threshold", retry_allowed=True)

    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), verification_gate=FailingVerificationGate())
    execution = await service.execute_workflow(uuid4(), {"input": "data"})
    assert len(execution.gate_results) == 1
    gate = list(execution.gate_results.values())[0]
    assert gate.passed is False
    assert gate.reason == "Quality below threshold"


@pytest.mark.asyncio
async def test_execute_workflow_without_verification_gate(publisher):
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory())
    execution = await service.execute_workflow(uuid4(), {"input": "data"})
    assert execution.status in ("running", "completed")
    assert len(execution.gate_results) == 0


@pytest.mark.asyncio
async def test_execute_workflow_with_engine(publisher):
    from cabinet.core.workflow.engine import WorkflowEngine
    from cabinet.models.workflows import (
        EndNode,
        SkillNode,
        TriggerNode,
        Workflow,
        WorkflowEdge,
    )

    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), workflow_engine=engine)
    execution = await service.execute_workflow(workflow.id, {"__workflow__": workflow})
    assert execution.status == "completed"
    assert len(execution.completed_nodes) >= 1


@pytest.mark.asyncio
async def test_resume_workflow(publisher):
    from cabinet.core.workflow.engine import WorkflowEngine
    from cabinet.models.workflows import (
        EndNode,
        HumanApprovalNode,
        TriggerNode,
        Workflow,
        WorkflowEdge,
    )

    trigger_id = uuid4()
    approval_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="approval_flow",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), workflow_engine=engine)
    execution = await service.execute_workflow(workflow.id, {"__workflow__": workflow})
    assert execution.status == "paused"

    resumed = await service.resume_workflow(execution.id, {"approved": True, "option": "go"})
    assert resumed.status == "completed"


@pytest.mark.asyncio
async def test_resume_workflow_not_paused_raises(service):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    await service.submit_task(order)
    with pytest.raises(KeyError):
        await service.resume_workflow(uuid4(), {})


@pytest.mark.asyncio
async def test_resume_workflow_wrong_status_raises(publisher):
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory())
    execution = await service.execute_workflow(uuid4(), {"input": "data"})
    with pytest.raises(ValueError, match="not paused"):
        await service.resume_workflow(execution.id, {"approved": True})


@pytest.mark.asyncio
async def test_resume_workflow_continues_execution(publisher):
    from cabinet.core.workflow.engine import WorkflowEngine
    from cabinet.models.workflows import (
        EndNode,
        HumanApprovalNode,
        SkillNode,
        TriggerNode,
        Workflow,
        WorkflowEdge,
    )

    trigger_id = uuid4()
    approval_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="approval_then_skill",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), workflow_engine=engine)
    execution = await service.execute_workflow(workflow.id, {"__workflow__": workflow})
    assert execution.status == "paused"

    resumed = await service.resume_workflow(execution.id, {"approved": True})
    assert resumed.status == "completed"
    assert str(skill_id) in resumed.results


@pytest.mark.asyncio
async def test_cancel_workflow(publisher):
    from cabinet.core.workflow.engine import WorkflowEngine
    from cabinet.models.workflows import (
        EndNode,
        HumanApprovalNode,
        TriggerNode,
        Workflow,
        WorkflowEdge,
    )

    trigger_id = uuid4()
    approval_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="cancel_flow",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), workflow_engine=engine)
    execution = await service.execute_workflow(workflow.id, {"__workflow__": workflow})
    assert execution.status == "paused"

    cancelled = await service.cancel_workflow(execution.id, reason="user request")
    assert cancelled.status == "cancelled"


@pytest.mark.asyncio
async def test_cancel_workflow_not_found_raises(service):
    with pytest.raises(KeyError):
        await service.cancel_workflow(uuid4())


@pytest.mark.asyncio
async def test_cancel_completed_workflow_raises(publisher):
    from cabinet.core.workflow.engine import WorkflowEngine
    from cabinet.models.workflows import (
        EndNode,
        SkillNode,
        TriggerNode,
        Workflow,
        WorkflowEdge,
    )

    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="completed_flow",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), workflow_engine=engine)
    execution = await service.execute_workflow(workflow.id, {"__workflow__": workflow})
    assert execution.status == "completed"

    with pytest.raises(ValueError, match="cannot be cancelled"):
        await service.cancel_workflow(execution.id)
