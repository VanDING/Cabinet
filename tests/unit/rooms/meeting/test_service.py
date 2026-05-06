import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.models.events import DeliberationProposal, DeliberationDissent
from cabinet.rooms.meeting.models import (
    DissentItem,
    MeetingLevel,
)
from cabinet.rooms.meeting.service import MeetingRoomService


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
    store = RoomEventStore("meeting")
    return MeetingRoomService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_start_session(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    assert session.topic == "topic"
    assert session.level == MeetingLevel.MULTI_PARTY
    assert session.status == "open"
    assert p1 in session.participants


@pytest.mark.asyncio
async def test_add_perspective(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    agent_id = uuid4()
    perspective = await service.add_perspective(session.id, agent_id, "my view")
    assert perspective.content == "my view"
    assert perspective.agent_id == agent_id


@pytest.mark.asyncio
async def test_cross_validate(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    await service.add_perspective(session.id, uuid4(), "view1")
    await service.add_perspective(session.id, uuid4(), "view2")
    result = await service.cross_validate(session.id)
    assert result.consensus is not None


@pytest.mark.asyncio
async def test_cross_validate_with_dissent_publishes_event(service, publisher):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    await service.add_perspective(session.id, uuid4(), "view1")
    await service.add_perspective(session.id, uuid4(), "view2")
    publisher.published.clear()
    await service.cross_validate(session.id, dissent_items=[
        DissentItem(agent_id=uuid4(), content="I disagree", reasoning="risk"),
    ])
    assert len(publisher.published) == 1
    assert publisher.published[0][1] == "deliberation.dissent"
    assert isinstance(publisher.published[0][2], DeliberationDissent)


@pytest.mark.asyncio
async def test_converge(service, publisher):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    await service.add_perspective(session.id, uuid4(), "view1")
    publisher.published.clear()
    result = await service.converge(session.id)
    assert result.proposal_text is not None
    assert len(publisher.published) == 1
    assert publisher.published[0][1] == "deliberation.proposal"
    assert isinstance(publisher.published[0][2], DeliberationProposal)


@pytest.mark.asyncio
async def test_wake_expert(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.EXPERT_HEARING, [p1], project_id=pid)
    expert_id = uuid4()
    await service.wake_expert(session.id, expert_id)
    assert expert_id in service._sessions[session.id].experts


@pytest.mark.asyncio
async def test_close_session(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    output = await service.close_session(session.id)
    assert output.session_id == session.id
    assert service._sessions[session.id].status == "closed"


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    agent_id = uuid4()
    await service.add_perspective(session.id, agent_id, "view1")
    new_service = MeetingRoomService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert session.id in new_service._sessions
    assert session.id in new_service._perspectives
    assert len(new_service._perspectives[session.id]) == 1


@pytest.mark.asyncio
async def test_start_session_invalid_level_raises(service):
    with pytest.raises(ValueError):
        await service.start_session("", MeetingLevel.FREE_DRAFT, [], project_id=uuid4())


@pytest.mark.asyncio
async def test_add_perspective_unknown_session_raises(service):
    with pytest.raises(KeyError):
        await service.add_perspective(uuid4(), uuid4(), "view")
