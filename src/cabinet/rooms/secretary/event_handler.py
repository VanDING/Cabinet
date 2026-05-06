from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import DecisionResponse, MessageEnvelope, SummaryInsight
from cabinet.rooms.secretary.models import NotificationEvent

if TYPE_CHECKING:
    from cabinet.rooms.secretary.protocol import SecretaryAgent

logger = logging.getLogger(__name__)


class SecretaryEventHandler:
    def __init__(self, room: SecretaryAgent):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="secretary",
            produces=["secretary.notification"],
            consumes=["decision.response", "summary.insight"],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        msg_type = envelope.message_type
        if msg_type == "decision.response":
            response = DecisionResponse(**envelope.payload)
            notification = NotificationEvent(
                event_type="decision_made",
                severity="info",
                source="room:decision",
                content=f"Decision made: {response.chosen_option}",
                related_decision_id=response.decision_id,
            )
            await self._room.notify(notification)
        elif msg_type == "summary.insight":
            insight = SummaryInsight(**envelope.payload)
            severity = "warning" if insight.insight_type == "anomaly" else "info"
            notification = NotificationEvent(
                event_type="insight_generated",
                severity=severity,
                source="room:summary",
                content=insight.content,
            )
            await self._room.notify(notification)
        else:
            logger.warning("SecretaryEventHandler received unknown event type: %s", msg_type)
