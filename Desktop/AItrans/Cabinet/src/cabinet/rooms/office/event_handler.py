from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import DecisionResponse, MessageEnvelope, TaskOrder

if TYPE_CHECKING:
    from cabinet.rooms.office.protocol import OfficeScheduler

logger = logging.getLogger(__name__)


class OfficeEventHandler:
    def __init__(self, room: OfficeScheduler):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="office",
            produces=["task.status_update", "task.failure"],
            consumes=["decision.response", "task.order"],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        msg_type = envelope.message_type
        if msg_type == "task.order":
            order = TaskOrder(**envelope.payload)
            await self._room.submit_task(order)
        elif msg_type == "decision.response":
            response = DecisionResponse(**envelope.payload)
            order = TaskOrder(
                employee_id=response.chosen_option.get("employee_id"),
                skill_id=response.chosen_option.get("skill_id"),
                inputs=response.chosen_option.get("inputs", {}),
            )
            await self._room.submit_task(order)
        else:
            logger.warning("OfficeEventHandler received unknown event type: %s", msg_type)
