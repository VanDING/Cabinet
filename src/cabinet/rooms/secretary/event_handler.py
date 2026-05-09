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
            consumes=["decision.response", "summary.insight",
                       "designer.session_created", "summary.authorization_audited",
                       "decision.created"],
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
        elif msg_type == "designer.session_created":
            description = envelope.payload.get("description", "")
            await self._room.recommend_templates(description)
        elif msg_type == "summary.authorization_audited":
            pipe_id = envelope.payload.get("pipe_id")
            history = envelope.payload.get("history", [])
            if pipe_id:
                from uuid import UUID
                await self._room.calibrate_pipe(UUID(pipe_id), history)
        elif msg_type == "decision.created":
            captain_id = envelope.payload.get("captain_id", "")
            await self._room.detect_cross_project_conflicts(captain_id)
        else:
            logger.warning("SecretaryEventHandler received unknown event type: %s", msg_type)
