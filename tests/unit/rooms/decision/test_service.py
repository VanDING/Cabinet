import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.models.decisions import Decision, DecisionType
from cabinet.models.events import DecisionRequest
from cabinet.rooms.decision.models import AuthorizationRule, AuthorizationVerdict
from cabinet.rooms.decision.service import DecisionRoomService


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
    store = RoomEventStore("decision")
    return DecisionRoomService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_submit(service):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[{"label": "yes"}],
    )
    decision = await service.submit(request)
    assert decision.title == "hire"
    assert decision.status.value == "pending"


@pytest.mark.asyncio
async def test_approve(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[{"label": "yes"}],
    )
    decision = await service.submit(request)
    publisher.published.clear()
    approved = await service.approve(decision.id, {"label": "yes"})
    assert approved.status.value == "approved"
    assert approved.chosen_option == {"label": "yes"}
    assert any(mt == "decision.response" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_approve_with_execution_triggers_task_order(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="action",
        title="execute task", options=[{"label": "go"}],
    )
    decision = await service.submit(request)
    publisher.published.clear()
    chosen = {"label": "go", "employee_id": uuid4(), "skill_id": uuid4()}
    await service.approve(decision.id, chosen)
    msg_types = [mt for _, mt, _, _ in publisher.published]
    assert "decision.response" in msg_types
    assert "task.order" in msg_types


@pytest.mark.asyncio
async def test_reject(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[],
    )
    decision = await service.submit(request)
    publisher.published.clear()
    rejected = await service.reject(decision.id, "too risky")
    assert rejected.status.value == "rejected"
    assert any(mt == "decision.response" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_delegate(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="execution",
        title="deploy", options=[],
    )
    decision = await service.submit(request)
    publisher.published.clear()
    delegated = await service.delegate(decision.id, "agent-1")
    assert delegated.status.value == "delegated"
    assert any(mt == "decision.response" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_set_authorization_and_check(service):
    rule = AuthorizationRule(
        captain_id="cap1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
        conditions=["budget < 1000"],
    )
    await service.set_authorization(rule)
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="small task",
        description="minor",
        captain_id="cap1",
    )
    verdict = await service.check_authorization(decision)
    assert verdict.auto_process is True


@pytest.mark.asyncio
async def test_cascade(service, publisher):
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="failure",
        description="task failed",
        captain_id="system",
    )
    publisher.published.clear()
    children = await service.cascade(decision)
    assert len(children) >= 1
    assert any(mt == "decision.response" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_get_dashboard(service):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[],
    )
    await service.submit(request)
    dashboard = await service.get_dashboard(uuid4())
    assert dashboard.total_pending >= 1


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[],
    )
    await service.submit(request)
    new_service = DecisionRoomService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert len(new_service._decisions) == len(service._decisions)


@pytest.mark.asyncio
async def test_submit_unknown_decision_raises(service):
    with pytest.raises(KeyError):
        await service.approve(uuid4(), {"label": "yes"})


@pytest.mark.asyncio
async def test_check_authorization_with_escalation_protocol(publisher):
    from cabinet.core.harness.escalation import DefaultEscalationProtocol

    rules = [AuthorizationRule(
        captain_id="cap1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
    )]
    protocol = DefaultEscalationProtocol(rules=rules)
    store = RoomEventStore("decision")
    service = DecisionRoomService(store, publisher, StubAgentFactory(), escalation_protocol=protocol)

    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="routine task",
        description="auto-approvable",
        captain_id="cap1",
    )
    verdict = await service.check_authorization(decision)
    assert verdict.auto_process is True
    assert verdict.requires_captain is False


@pytest.mark.asyncio
async def test_check_authorization_escalation_strategic(publisher):
    from cabinet.core.harness.escalation import DefaultEscalationProtocol

    protocol = DefaultEscalationProtocol(rules=[])
    store = RoomEventStore("decision")
    service = DecisionRoomService(store, publisher, StubAgentFactory(), escalation_protocol=protocol)

    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="market direction",
        description="Which market to enter",
        captain_id="cap1",
    )
    verdict = await service.check_authorization(decision)
    assert verdict.requires_captain is True
    assert verdict.auto_process is False
    assert "strategic" in verdict.reason.lower()


@pytest.mark.asyncio
async def test_check_authorization_without_escalation_protocol(publisher):
    store = RoomEventStore("decision")
    service = DecisionRoomService(store, publisher, StubAgentFactory())

    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="market direction",
        description="Which market to enter",
        captain_id="cap1",
    )
    verdict = await service.check_authorization(decision)
    assert isinstance(verdict, AuthorizationVerdict)
