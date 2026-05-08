from __future__ import annotations

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import MessageEnvelope


class MeetingEventHandler:
    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="meeting",
            produces=["deliberation.proposal", "deliberation.dissent"],
            consumes=[],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        pass
