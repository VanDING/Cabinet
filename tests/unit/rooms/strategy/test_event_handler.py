from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.models.events import DeliberationProposal, MessageEnvelope
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.protocol import StrategyDecoder


def test_strategy_handler_satisfies_protocol():
    room = AsyncMock(spec=StrategyDecoder)
    handler = StrategyEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_strategy_handler_contract():
    room = AsyncMock(spec=StrategyDecoder)
    handler = StrategyEventHandler(room)
    contract = handler.contract
    assert isinstance(contract, EventContract)
    assert contract.room_name == "strategy"
    assert "strategy.decode_result" in contract.produces
    assert "deliberation.proposal" in contract.consumes


@pytest.mark.asyncio
async def test_strategy_handler_handles_deliberation_proposal():
    room = AsyncMock(spec=StrategyDecoder)
    handler = StrategyEventHandler(room)

    proposal = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:strategy"],
        message_type="deliberation.proposal",
        payload=proposal.model_dump(),
    )
    await handler.handle(env)
    room.decode.assert_awaited_once()
    call_args = room.decode.call_args
    assert call_args[0][0].proposal.proposal_text == "expand market"


@pytest.mark.asyncio
async def test_strategy_handler_ignores_unknown_event():
    room = AsyncMock(spec=StrategyDecoder)
    handler = StrategyEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:strategy"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.decode.assert_not_awaited()
