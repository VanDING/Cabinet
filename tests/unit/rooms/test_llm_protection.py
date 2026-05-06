from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventWiring


def _make_wiring():
    wiring = MagicMock(spec=RoomEventWiring)
    wiring.publish = AsyncMock()
    return wiring


class FailingAgentFactory:
    async def create_agent(self, agent_id, role, **kwargs):
        raise RuntimeError("LLM provider unavailable")


@pytest.mark.asyncio
async def test_meeting_add_perspective_graceful_degradation():
    from cabinet.rooms.meeting.service import MeetingRoomService
    from cabinet.rooms.meeting.models import MeetingLevel

    store = RoomEventStore("meeting")
    wiring = _make_wiring()
    svc = MeetingRoomService(store, wiring, FailingAgentFactory())
    session = await svc.start_session("test", MeetingLevel.FREE_DRAFT, [uuid4()])
    perspective = await svc.add_perspective(session.id, uuid4())
    assert "Error generating perspective" in perspective.content


@pytest.mark.asyncio
async def test_strategy_decode_graceful_degradation():
    from cabinet.rooms.strategy.service import StrategyDecoderService
    from cabinet.rooms.strategy.models import DecodeContext
    from cabinet.rooms.meeting.models import DeliberationOutput, DeliberationResult, ConvergenceResult

    store = RoomEventStore("strategy")
    wiring = _make_wiring()
    svc = StrategyDecoderService(store, wiring, FailingAgentFactory())
    proposal = DeliberationOutput(
        session_id=uuid4(),
        proposal=DeliberationResult(
            session_id=uuid4(),
            proposal_text="test",
            confidence=0.5,
            reasoning_summary="test",
            convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
            rounds_used=1,
            rumination_detected=False,
        ),
    )
    context = DecodeContext(project_id=uuid4(), captain_id="cap1", existing_constraints=[])
    blueprint = await svc.decode(proposal, context)
    assert len(blueprint.domains) > 0


@pytest.mark.asyncio
async def test_summary_generate_insights_graceful_degradation():
    from cabinet.rooms.summary.service import SummaryRoomService
    from cabinet.rooms.summary.models import ReviewType

    store = RoomEventStore("summary")
    wiring = _make_wiring()
    svc = SummaryRoomService(store, wiring, FailingAgentFactory())
    session = await svc.start_review(uuid4(), ReviewType.PROJECT_REVIEW)
    insights = await svc.generate_insights(session.id)
    assert len(insights) == 1
    assert insights[0].insight_type == "error"


@pytest.mark.asyncio
async def test_decision_submit_graceful_degradation():
    from cabinet.rooms.decision.service import DecisionRoomService
    from cabinet.models.events import DecisionRequest

    store = RoomEventStore("decision")
    wiring = _make_wiring()
    svc = DecisionRoomService(store, wiring, FailingAgentFactory())
    request = DecisionRequest(
        decision_id=uuid4(), title="test", decision_type="strategic", options=[],
    )
    decision = await svc.submit(request)
    assert decision.title == "test"


@pytest.mark.asyncio
async def test_secretary_greet_graceful_degradation():
    from cabinet.rooms.secretary.service import SecretaryAgentService

    store = RoomEventStore("secretary")
    wiring = _make_wiring()
    svc = SecretaryAgentService(store, wiring, FailingAgentFactory())
    greeting = await svc.greet("cap1")
    assert "Welcome back" in greeting.message


@pytest.mark.asyncio
async def test_secretary_process_input_graceful_degradation():
    from cabinet.rooms.secretary.service import SecretaryAgentService
    from cabinet.rooms.secretary.models import InteractionContext

    store = RoomEventStore("secretary")
    wiring = _make_wiring()
    svc = SecretaryAgentService(store, wiring, FailingAgentFactory())
    ctx = InteractionContext(captain_id="cap1", channel="terminal")
    response = await svc.process_input("hello", ctx)
    assert "error" in response.message.lower() or "try again" in response.message.lower()
