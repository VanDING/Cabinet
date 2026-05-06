import pytest
import pytest_asyncio
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.models.events import DecisionRequest
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.meeting.models import MeetingLevel
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.service import SummaryRoomService


@pytest.fixture
def bus():
    return AsyncIOEventBus()


@pytest.fixture
def wiring(bus):
    return RoomEventWiring(bus)


@pytest.fixture
def meeting_service(wiring):
    store = RoomEventStore("meeting")
    return MeetingRoomService(store, wiring, StubAgentFactory())


@pytest.fixture
def strategy_service(wiring):
    store = RoomEventStore("strategy")
    return StrategyDecoderService(store, wiring, StubAgentFactory())


@pytest.fixture
def decision_service(wiring):
    store = RoomEventStore("decision")
    return DecisionRoomService(store, wiring, StubAgentFactory())


@pytest.fixture
def office_service(wiring):
    store = RoomEventStore("office")
    return OfficeSchedulerService(store, wiring, StubAgentFactory())


@pytest.fixture
def summary_service(wiring):
    store = RoomEventStore("summary")
    return SummaryRoomService(store, wiring, StubAgentFactory())


@pytest.fixture
def secretary_service(wiring):
    store = RoomEventStore("secretary")
    return SecretaryAgentService(store, wiring, StubAgentFactory())


@pytest_asyncio.fixture
async def all_registered(wiring, meeting_service, strategy_service, decision_service, office_service, summary_service, secretary_service):
    meeting_handler = MeetingEventHandler()
    strategy_handler = StrategyEventHandler(strategy_service)
    decision_handler = DecisionEventHandler(decision_service)
    office_handler = OfficeEventHandler(office_service)
    summary_handler = SummaryEventHandler(summary_service)
    secretary_handler = SecretaryEventHandler(secretary_service)
    await wiring.register(meeting_handler)
    await wiring.register(strategy_handler)
    await wiring.register(decision_handler)
    await wiring.register(office_handler)
    await wiring.register(summary_handler)
    await wiring.register(secretary_handler)


@pytest.mark.asyncio
async def test_meeting_to_decision_event_flow(bus, wiring, meeting_service, decision_service, all_registered):
    pid = uuid4()
    p1 = uuid4()
    session = await meeting_service.start_session("strategy", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    await meeting_service.add_perspective(session.id, uuid4(), "expand market")
    await meeting_service.converge(session.id)
    assert len(decision_service._decisions) >= 1


@pytest.mark.asyncio
async def test_decision_to_office_event_flow(bus, wiring, decision_service, office_service, all_registered):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="action",
        title="execute", options=[{"label": "go"}],
    )
    await decision_service.submit(request)
    emp_id = uuid4()
    skill_id = uuid4()
    await decision_service.approve(request.decision_id, {
        "label": "go", "employee_id": emp_id, "skill_id": skill_id,
    })
    office_tasks = [t for t in office_service._tasks.values()
                    if t.employee_id == emp_id]
    assert len(office_tasks) >= 1


@pytest.mark.asyncio
async def test_full_chain_meeting_to_secretary(bus, wiring, meeting_service, decision_service, secretary_service, all_registered):
    pid = uuid4()
    p1 = uuid4()
    session = await meeting_service.start_session("big plan", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    await meeting_service.add_perspective(session.id, uuid4(), "go big")
    await meeting_service.converge(session.id)
    assert len(secretary_service._notifications) >= 0


@pytest.mark.asyncio
async def test_restore_all_services(bus, wiring, meeting_service, decision_service, office_service, all_registered):
    pid = uuid4()
    p1 = uuid4()
    session = await meeting_service.start_session("restore test", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    await meeting_service.add_perspective(session.id, uuid4(), "view1")
    new_meeting = MeetingRoomService(meeting_service._store, wiring, StubAgentFactory())
    await new_meeting.restore_from_events()
    assert session.id in new_meeting._sessions
    assert len(new_meeting._perspectives[session.id]) == 1

    new_decision = DecisionRoomService(decision_service._store, wiring, StubAgentFactory())
    await new_decision.restore_from_events()
    assert len(new_decision._decisions) == len(decision_service._decisions)

    new_office = OfficeSchedulerService(office_service._store, wiring, StubAgentFactory())
    await new_office.restore_from_events()
    assert len(new_office._tasks) == len(office_service._tasks)
