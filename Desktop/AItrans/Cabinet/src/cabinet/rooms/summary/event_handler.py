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
        else:
            logger.warning("SummaryEventHandler received unknown event type: %s", msg_type)
