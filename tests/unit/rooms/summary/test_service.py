import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    ReviewType,
)
from cabinet.rooms.summary.service import SummaryRoomService


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
    store = RoomEventStore("summary")
    return SummaryRoomService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_start_review(service):
    pid = uuid4()
    session = await service.start_review(pid, ReviewType.PROJECT_REVIEW)
    assert session.project_id == pid
    assert session.review_type == ReviewType.PROJECT_REVIEW


@pytest.mark.asyncio
async def test_generate_insights(service, publisher):
    pid = uuid4()
    session = await service.start_review(pid, ReviewType.CAPTAIN_INSIGHT)
    publisher.published.clear()
    insights = await service.generate_insights(session.id)
    assert isinstance(insights, list)
    assert any(mt == "summary.insight" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_build_decision_tree(service):
    pid = uuid4()
    tree = await service.build_decision_tree(pid)
    assert isinstance(tree, DecisionTree)
    assert tree.project_id == pid


@pytest.mark.asyncio
async def test_suggest_improvements(service):
    pid = uuid4()
    session = await service.start_review(pid, ReviewType.ORG_OPTIMIZATION)
    suggestions = await service.suggest_improvements(session.id)
    assert isinstance(suggestions, list)


@pytest.mark.asyncio
async def test_audit_authorization_usage(service):
    audit = await service.audit_authorization_usage("cap1")
    assert isinstance(audit, AuthorizationAudit)
    assert audit.captain_id == "cap1"


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    pid = uuid4()
    await service.start_review(pid, ReviewType.PROJECT_REVIEW)
    new_service = SummaryRoomService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert len(new_service._sessions) == len(service._sessions)
