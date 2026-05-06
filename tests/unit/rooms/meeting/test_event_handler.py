import pytest

from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.models.events import MessageEnvelope
from cabinet.rooms.meeting.event_handler import MeetingEventHandler


def test_meeting_handler_satisfies_protocol():
    handler = MeetingEventHandler()
    assert isinstance(handler, RoomEventHandler)


def test_meeting_handler_contract():
    handler = MeetingEventHandler()
    contract = handler.contract
    assert isinstance(contract, EventContract)
    assert contract.room_name == "meeting"
    assert "deliberation.proposal" in contract.produces
    assert "deliberation.dissent" in contract.produces
    assert contract.consumes == []


@pytest.mark.asyncio
async def test_meeting_handler_handle_is_noop():
    handler = MeetingEventHandler()
    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:meeting"],
        message_type="some.event",
        payload={},
    )
    await handler.handle(env)
