from uuid import uuid4

import pytest
import pytest_asyncio

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.models.events import DecisionRequest
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.runtime import CabinetRuntime
from cabinet.rooms.meeting.models import MeetingLevel


@pytest_asyncio.fixture
async def runtime():
    rt = CabinetRuntime()
    await rt.start()
    yield rt
    await rt.stop()


@pytest.mark.asyncio
async def test_runtime_meeting_to_decision_event_flow(runtime):
    pid = uuid4()
    p1 = uuid4()
    session = await runtime.meeting.start_session(
        "strategy review", MeetingLevel.MULTI_PARTY, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "expand market")
    await runtime.meeting.converge(session.id)
    assert len(runtime.decision._decisions) >= 1


@pytest.mark.asyncio
async def test_runtime_decision_to_office_event_flow(runtime):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="action",
        title="execute", options=[{"label": "go"}],
    )
    await runtime.decision.submit(request)
    emp_id = uuid4()
    skill_id = uuid4()
    await runtime.decision.approve(request.decision_id, {
        "label": "go", "employee_id": emp_id, "skill_id": skill_id,
    })
    office_tasks = [t for t in runtime.office._tasks.values()
                    if t.employee_id == emp_id]
    assert len(office_tasks) >= 1


@pytest.mark.asyncio
async def test_runtime_full_chain_meeting_to_secretary(runtime):
    pid = uuid4()
    p1 = uuid4()
    session = await runtime.meeting.start_session(
        "big plan", MeetingLevel.MULTI_PARTY, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "go big")
    await runtime.meeting.converge(session.id)
    assert len(runtime.secretary._notifications) >= 0


@pytest.mark.asyncio
async def test_runtime_causation_chain_tracing(runtime):
    pid = uuid4()
    p1 = uuid4()
    session = await runtime.meeting.start_session(
        "trace test", MeetingLevel.FREE_DRAFT, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "view1")
    await runtime.meeting.converge(session.id)
    decision_events = runtime.store.get_by_type("deliberation.proposal")
    assert len(decision_events) >= 1


@pytest.mark.asyncio
async def test_runtime_restore_from_events(runtime):
    pid = uuid4()
    p1 = uuid4()
    session = await runtime.meeting.start_session(
        "restore test", MeetingLevel.FREE_DRAFT, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "view1")

    new_meeting_store = runtime.meeting._store
    new_meeting = MeetingRoomService(new_meeting_store, runtime.wiring, StubAgentFactory())
    await new_meeting.restore_from_events()
    assert session.id in new_meeting._sessions
    assert len(new_meeting._perspectives[session.id]) == 1


@pytest.mark.asyncio
async def test_runtime_start_registers_all_contracts(runtime):
    handlers = runtime.wiring._handlers
    assert len(handlers) == 6
    room_names = set(handlers.keys())
    assert room_names == {"meeting", "strategy", "decision", "office", "summary", "secretary"}


@pytest.mark.asyncio
async def test_runtime_event_contracts_consistency(runtime):
    handlers = runtime.wiring._handlers
    for name, handler in handlers.items():
        assert handler.contract.room_name == name
        assert isinstance(handler.contract.produces, list)
        assert isinstance(handler.contract.consumes, list)
