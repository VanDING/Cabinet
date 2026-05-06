from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import DecisionRequest, MessageEnvelope, TaskFailure

if TYPE_CHECKING:
    from cabinet.rooms.decision.protocol import DecisionRoom

logger = logging.getLogger(__name__)

_PROPOSAL_TYPES = {"deliberation.proposal", "deliberation.dissent", "strategy.decode_result"}


class DecisionEventHandler:
    def __init__(self, room: DecisionRoom):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="decision",
            produces=["decision.response", "task.order"],
            consumes=[
                "deliberation.proposal",
                "deliberation.dissent",
                "strategy.decode_result",
                "decision.request",
                "task.failure",
            ],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        msg_type = envelope.message_type
        if msg_type == "decision.request":
            request = DecisionRequest(**envelope.payload)
            await self._room.submit(request)
        elif msg_type in _PROPOSAL_TYPES:
            request = self._translate_proposal(msg_type, envelope.payload)
            await self._room.submit(request)
        elif msg_type == "task.failure":
            failure = TaskFailure(**envelope.payload)
            from cabinet.models.decisions import Decision, DecisionType

            decision = Decision(
                project_id=uuid.uuid4(),
                decision_type=DecisionType.ANOMALY,
                title=f"Task failure: {failure.error_message}",
                description=failure.error_message,
                captain_id="system",
            )
            await self._room.cascade(decision)
        else:
            logger.warning("DecisionEventHandler received unknown event type: %s", msg_type)

    def _translate_proposal(self, msg_type: str, payload: dict) -> DecisionRequest:
        title = payload.get("proposal_text", payload.get("dissent_text", "Unknown proposal"))
        decision_type = "strategic"
        if msg_type == "deliberation.dissent":
            decision_type = "action"
        elif msg_type == "strategy.decode_result":
            decision_type = "strategic"
        return DecisionRequest(
            decision_id=uuid.uuid4(),
            decision_type=decision_type,
            title=title,
        )
