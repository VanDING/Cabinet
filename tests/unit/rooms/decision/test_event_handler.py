import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import RoomEventHandler
from cabinet.models.events import (
    DecisionRequest,
    DeliberationProposal,
    MessageEnvelope,
    TaskFailure,
)
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.protocol import DecisionRoom


def test_decision_handler_satisfies_protocol():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_decision_handler_contract():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)
    contract = handler.contract
    assert contract.room_name == "decision"
    assert "decision.response" in contract.produces
    assert "task.order" in contract.produces
    assert "deliberation.proposal" in contract.consumes
    assert "deliberation.dissent" in contract.consumes
    assert "strategy.decode_result" in contract.consumes
    assert "decision.request" in contract.consumes
    assert "task.failure" in contract.consumes


@pytest.mark.asyncio
async def test_decision_handler_handles_deliberation_proposal():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)

    proposal = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload=proposal.model_dump(),
    )
    await handler.handle(env)
    room.submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_decision_handler_handles_decision_request():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)

    request = DecisionRequest(
        decision_id=uuid.uuid4(),
        decision_type="strategic",
        title="Market expansion",
    )
    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:decision"],
        message_type="decision.request",
        payload=request.model_dump(),
    )
    await handler.handle(env)
    room.submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_decision_handler_handles_task_failure():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)

    failure = TaskFailure(
        task_id=uuid.uuid4(),
        error_message="API timeout",
        retry_count=3,
    )
    env = MessageEnvelope(
        sender="room:office",
        recipients=["room:decision"],
        message_type="task.failure",
        payload=failure.model_dump(),
    )
    await handler.handle(env)
    room.cascade.assert_awaited_once()


@pytest.mark.asyncio
async def test_decision_handler_ignores_unknown_event():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:decision"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.submit.assert_not_awaited()
    room.cascade.assert_not_awaited()
