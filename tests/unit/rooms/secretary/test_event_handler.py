import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import RoomEventHandler
from cabinet.models.events import DecisionResponse, MessageEnvelope, SummaryInsight
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.protocol import SecretaryAgent


def test_secretary_handler_satisfies_protocol():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_secretary_handler_contract():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)
    contract = handler.contract
    assert contract.room_name == "secretary"
    assert "secretary.notification" in contract.produces
    assert "decision.response" in contract.consumes
    assert "summary.insight" in contract.consumes


@pytest.mark.asyncio
async def test_secretary_handler_handles_decision_response():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    env = MessageEnvelope(
        sender="room:decision",
        recipients=["room:secretary"],
        message_type="decision.response",
        payload=response.model_dump(),
    )
    await handler.handle(env)
    room.notify.assert_awaited_once()


@pytest.mark.asyncio
async def test_secretary_handler_handles_summary_insight():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)

    insight = SummaryInsight(
        insight_type="pattern",
        content="Recurring delay in task completion",
    )
    env = MessageEnvelope(
        sender="room:summary",
        recipients=["room:secretary"],
        message_type="summary.insight",
        payload=insight.model_dump(),
    )
    await handler.handle(env)
    room.notify.assert_awaited_once()


@pytest.mark.asyncio
async def test_secretary_handler_ignores_unknown_event():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:secretary"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.notify.assert_not_awaited()


@pytest.mark.asyncio
async def test_handles_designer_session_created():
    mock_room = AsyncMock()
    handler = SecretaryEventHandler(mock_room)
    envelope = MessageEnvelope(
        sender="designer",
        recipients=["secretary"],
        message_type="designer.session_created",
        payload={"description": "搭建招聘流程"},
    )
    await handler.handle(envelope)
    mock_room.recommend_templates.assert_called_once_with("搭建招聘流程")


@pytest.mark.asyncio
async def test_handles_authorization_audited():
    mock_room = AsyncMock()
    handler = SecretaryEventHandler(mock_room)
    envelope = MessageEnvelope(
        sender="summary",
        recipients=["secretary"],
        message_type="summary.authorization_audited",
        payload={"pipe_id": str(uuid.uuid4()), "history": []},
    )
    await handler.handle(envelope)
    assert mock_room.calibrate_pipe.called


@pytest.mark.asyncio
async def test_handles_decision_created():
    mock_room = AsyncMock()
    handler = SecretaryEventHandler(mock_room)
    envelope = MessageEnvelope(
        sender="decision",
        recipients=["secretary"],
        message_type="decision.created",
        payload={"captain_id": "captain-1"},
    )
    await handler.handle(envelope)
    mock_room.detect_cross_project_conflicts.assert_called_once_with("captain-1")
