from __future__ import annotations

import logging
from typing import TYPE_CHECKING
from uuid import uuid4

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import DeliberationProposal, MessageEnvelope
from cabinet.rooms.meeting.models import ConvergenceResult, DeliberationOutput, DeliberationResult
from cabinet.rooms.strategy.models import DecodeContext

if TYPE_CHECKING:
    from cabinet.rooms.strategy.protocol import StrategyDecoder

logger = logging.getLogger(__name__)


class StrategyEventHandler:
    def __init__(self, room: StrategyDecoder):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="strategy",
            produces=["strategy.decode_result"],
            consumes=["deliberation.proposal"],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        if envelope.message_type != "deliberation.proposal":
            return
        proposal = DeliberationProposal(**envelope.payload)
        deliberation_output = DeliberationOutput(
            session_id=envelope.correlation_id,
            proposal=DeliberationResult(
                session_id=envelope.correlation_id,
                proposal_text=proposal.proposal_text,
                confidence=proposal.confidence,
                reasoning_summary=proposal.reasoning_summary,
                convergence=ConvergenceResult(consensus="auto", dissent=[], unresolved=[]),
                rounds_used=0,
                rumination_detected=False,
            ),
        )
        context = DecodeContext(project_id=uuid4(), captain_id="", existing_constraints=[])
        await self._room.decode(deliberation_output, context)
