from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import (
    DecisionResponse,
    HarnessEvaluationResult,
    MessageEnvelope,
    SummaryReviewRequest,
    TaskStatusUpdate,
)

if TYPE_CHECKING:
    from cabinet.rooms.summary.protocol import SummaryRoom

logger = logging.getLogger(__name__)


class SummaryEventHandler:
    def __init__(self, room: SummaryRoom):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="summary",
            produces=["summary.insight"],
            consumes=[
                "decision.created",
                "project.created",
                "summary.audit_request",
                "decision.response",
                "task.status_update",
                "summary.review_request",
                "harness.evaluation_result",
            ],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        msg_type = envelope.message_type
        if msg_type == "summary.review_request":
            request = SummaryReviewRequest(**envelope.payload)
            from cabinet.rooms.summary.models import ReviewType

            await self._room.start_review(request.project_id, ReviewType(request.review_type))
        elif msg_type == "decision.response":
            response = DecisionResponse(**envelope.payload)
            from cabinet.rooms.summary.models import ReviewType

            await self._room.start_review(
                uuid.UUID(str(response.decision_id)), ReviewType.PROJECT_REVIEW
            )
        elif msg_type == "task.status_update":
            update = TaskStatusUpdate(**envelope.payload)
            await self._room.generate_insights(update.task_id)
        elif msg_type == "harness.evaluation_result":
            result = HarnessEvaluationResult(**envelope.payload)
            await self._room.generate_insights(result.evaluator_id)
        elif msg_type == "decision.created":
            payload = envelope.payload
            urgency = payload.get("urgency", "")
            decision_id = envelope.payload.get("decision_id", "")
            if urgency == "red" or envelope.payload.get("decision_type") == "strategic":
                from uuid import UUID

                await self._room.rehearse_decision(UUID(decision_id))
        elif msg_type == "project.created":
            description = envelope.payload.get("description", "")
            await self._room.retrieve_organizational_memory(description)
        elif msg_type == "summary.audit_request":
            captain_id = envelope.payload.get("captain_id", "")
            period = envelope.payload.get("period", "all")
            await self._room.audit_autonomous_decisions(captain_id, period)
        else:
            logger.warning("SummaryEventHandler received unknown event type: %s", msg_type)
