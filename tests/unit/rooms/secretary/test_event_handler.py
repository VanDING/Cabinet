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
