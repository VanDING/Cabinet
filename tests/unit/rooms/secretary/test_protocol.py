import uuid

import pytest

from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.secretary.models import (
    ConflictAlert,
    DailyBrief,
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationResult,
    PendingSummary,
    PipeCalibration,
    PipeTemplate,
    SecretaryLevel,
    SecretaryResponse,
)
from cabinet.rooms.secretary.protocol import SecretaryAgent


def test_secretary_agent_protocol_runtime_checkable():
    class MockSecretary:
        async def greet(self, captain_id):
            return Greeting(
                captain_id=captain_id,
                message="Good morning!",
                auto_processed_summary="Nothing auto-processed",
                today_highlights=[],
            )

        async def process_input(self, captain_input, context):
            return SecretaryResponse(
                message="Understood",
                level=SecretaryLevel.L1,
            )

        async def summarize_pending(self, captain_id):
            return PendingSummary(
                captain_id=captain_id,
                urgent_count=0,
                strategic_count=0,
                execution_count=0,
                evolution_count=0,
                digest="All clear",
            )

        async def notify(self, event):
            return NotificationResult(delivered=True, channel="dashboard", captain_should_see=True)

        async def filter_decision(self, decision):
            return FilterResult(should_present=True, reason="Requires Captain")

        async def recommend_templates(self, description):
            return []

        async def calibrate_pipe(self, pipe_id, history):
            from cabinet.models.pipes import ReasoningStrategy
            strategy = ReasoningStrategy(temperature=0.7)
            return PipeCalibration(
                pipe_id=pipe_id,
                original_reasoning=strategy,
                adjusted_reasoning=strategy,
                changes=[],
                confidence=0.5,
            )

        async def generate_daily_brief(self, captain_id):
            return DailyBrief(
                captain_id=captain_id,
                date="2026-05-08",
                active_projects=0,
                pending_decisions=0,
            )

        async def detect_cross_project_conflicts(self, captain_id):
            return []

    mock = MockSecretary()
    assert isinstance(mock, SecretaryAgent)


@pytest.mark.asyncio
async def test_secretary_greet_contract():
    class MockSecretary:
        async def greet(self, captain_id):
            return Greeting(
                captain_id=captain_id,
                message="Good morning, Captain!",
                auto_processed_summary="2 tasks completed",
                today_highlights=["Review proposal"],
            )

        async def process_input(self, captain_input, context):
            return SecretaryResponse(message="ok", level=SecretaryLevel.L1)

        async def summarize_pending(self, captain_id):
            return PendingSummary(captain_id=captain_id, urgent_count=0, strategic_count=0, execution_count=0, evolution_count=0, digest="Clear")

        async def notify(self, event):
            return NotificationResult(delivered=True, channel="dashboard", captain_should_see=True)

        async def filter_decision(self, decision):
            return FilterResult(should_present=True, reason="test")

        async def recommend_templates(self, description):
            return []

        async def calibrate_pipe(self, pipe_id, history):
            from cabinet.models.pipes import ReasoningStrategy
            strategy = ReasoningStrategy(temperature=0.7)
            return PipeCalibration(
                pipe_id=pipe_id,
                original_reasoning=strategy,
                adjusted_reasoning=strategy,
                changes=[],
                confidence=0.5,
            )

        async def generate_daily_brief(self, captain_id):
            return DailyBrief(
                captain_id=captain_id,
                date="2026-05-08",
                active_projects=0,
                pending_decisions=0,
            )

        async def detect_cross_project_conflicts(self, captain_id):
            return []

    secretary = MockSecretary()
    greeting = await secretary.greet("captain-1")
    assert isinstance(greeting, Greeting)
    assert greeting.captain_id == "captain-1"


@pytest.mark.asyncio
async def test_secretary_process_input_contract():
    class MockSecretary:
        async def greet(self, captain_id):
            return Greeting(captain_id=captain_id, message="Hi", auto_processed_summary="", today_highlights=[])

        async def process_input(self, captain_input, context):
            return SecretaryResponse(
                message=f"Processing: {captain_input}",
                level=SecretaryLevel.L1,
                requires_captain=True,
            )

        async def summarize_pending(self, captain_id):
            return PendingSummary(captain_id=captain_id, urgent_count=0, strategic_count=0, execution_count=0, evolution_count=0, digest="Clear")

        async def notify(self, event):
            return NotificationResult(delivered=True, channel="dashboard", captain_should_see=True)

        async def filter_decision(self, decision):
            return FilterResult(should_present=True, reason="test")

        async def recommend_templates(self, description):
            return []

        async def calibrate_pipe(self, pipe_id, history):
            from cabinet.models.pipes import ReasoningStrategy
            strategy = ReasoningStrategy(temperature=0.7)
            return PipeCalibration(
                pipe_id=pipe_id,
                original_reasoning=strategy,
                adjusted_reasoning=strategy,
                changes=[],
                confidence=0.5,
            )

        async def generate_daily_brief(self, captain_id):
            return DailyBrief(
                captain_id=captain_id,
                date="2026-05-08",
                active_projects=0,
                pending_decisions=0,
            )

        async def detect_cross_project_conflicts(self, captain_id):
            return []

    secretary = MockSecretary()
    ctx = InteractionContext(captain_id="captain-1")
    response = await secretary.process_input("Should we expand?", ctx)
    assert isinstance(response, SecretaryResponse)
    assert response.requires_captain is True


@pytest.mark.asyncio
async def test_secretary_filter_decision_contract():
    class MockSecretary:
        async def greet(self, captain_id):
            return Greeting(captain_id=captain_id, message="Hi", auto_processed_summary="", today_highlights=[])

        async def process_input(self, captain_input, context):
            return SecretaryResponse(message="ok", level=SecretaryLevel.L1)

        async def summarize_pending(self, captain_id):
            return PendingSummary(captain_id=captain_id, urgent_count=0, strategic_count=0, execution_count=0, evolution_count=0, digest="Clear")

        async def notify(self, event):
            return NotificationResult(delivered=True, channel="dashboard", captain_should_see=True)

        async def filter_decision(self, decision):
            if decision.decision_type == DecisionType.STRATEGIC:
                return FilterResult(should_present=True, reason="Strategic requires Captain")
            return FilterResult(should_present=False, auto_action="Auto-approved", reason="Within authorization")

        async def recommend_templates(self, description):
            return []

        async def calibrate_pipe(self, pipe_id, history):
            from cabinet.models.pipes import ReasoningStrategy
            strategy = ReasoningStrategy(temperature=0.7)
            return PipeCalibration(
                pipe_id=pipe_id,
                original_reasoning=strategy,
                adjusted_reasoning=strategy,
                changes=[],
                confidence=0.5,
            )

        async def generate_daily_brief(self, captain_id):
            return DailyBrief(
                captain_id=captain_id,
                date="2026-05-08",
                active_projects=0,
                pending_decisions=0,
            )

        async def detect_cross_project_conflicts(self, captain_id):
            return []

    secretary = MockSecretary()
    strategic = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Expand?",
        description="Market expansion",
        captain_id="captain-1",
    )
    result = await secretary.filter_decision(strategic)
    assert result.should_present is True

    execution = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Send email",
        description="Routine email",
        captain_id="captain-1",
    )
    result2 = await secretary.filter_decision(execution)
    assert result2.should_present is False
    assert result2.auto_action is not None
