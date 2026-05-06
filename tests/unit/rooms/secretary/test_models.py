import uuid

from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.decision.models import DecisionCard
from cabinet.rooms.secretary.models import (
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    SecretaryLevel,
    SecretaryResponse,
)


def test_secretary_level_values():
    assert SecretaryLevel.L1 == "L1"
    assert SecretaryLevel.L2 == "L2"
    assert SecretaryLevel.L3 == "L3"
    assert SecretaryLevel.L4 == "L4"


def test_greeting_creation():
    greeting = Greeting(
        captain_id="captain-1",
        message="Good morning, Captain!",
        auto_processed_summary="3 tasks auto-completed overnight",
        today_highlights=["Review market proposal", "API monitoring alert"],
    )
    assert greeting.captain_id == "captain-1"
    assert greeting.message == "Good morning, Captain!"
    assert len(greeting.today_highlights) == 2


def test_interaction_context():
    ctx = InteractionContext(
        captain_id="captain-1",
        time_of_day="morning",
    )
    assert ctx.project_id is None
    assert ctx.active_decisions == 0
    assert ctx.recent_interactions == []


def test_interaction_context_with_project():
    proj_id = uuid.uuid4()
    ctx = InteractionContext(
        captain_id="captain-1",
        project_id=proj_id,
        active_decisions=5,
        time_of_day="afternoon",
        recent_interactions=["Approved market expansion"],
    )
    assert ctx.project_id == proj_id
    assert ctx.active_decisions == 5


def test_secretary_response_l1():
    response = SecretaryResponse(
        message="I've created a decision card for your review.",
        level=SecretaryLevel.L1,
        requires_captain=True,
    )
    assert response.level == SecretaryLevel.L1
    assert response.decision_cards == []
    assert response.actions_taken == []


def test_secretary_response_with_cards():
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Expand?",
        description="Market expansion",
        captain_id="captain-1",
    )
    card = DecisionCard(
        decision=decision,
        urgency_color="yellow",
        summary="Strategic decision needed",
        options_summary=["Yes", "No"],
        source_room="meeting",
        created_ago="1 hour ago",
    )
    response = SecretaryResponse(
        message="You have a strategic decision pending.",
        level=SecretaryLevel.L2,
        decision_cards=[card],
        actions_taken=["Sorted decisions by urgency"],
    )
    assert len(response.decision_cards) == 1
    assert len(response.actions_taken) == 1


def test_pending_summary():
    summary = PendingSummary(
        captain_id="captain-1",
        urgent_count=2,
        strategic_count=3,
        execution_count=5,
        evolution_count=1,
        digest="2 urgent items need your attention. 5 execution tasks are auto-processing.",
    )
    assert summary.urgent_count == 2
    assert summary.strategic_count == 3
    assert "2 urgent" in summary.digest


def test_notification_event_info():
    event = NotificationEvent(
        event_type="task_completed",
        severity="info",
        source="office",
        content="Resume screening completed for 15 candidates",
    )
    assert event.severity == "info"
    assert event.related_decision_id is None


def test_notification_event_critical():
    decision_id = uuid.uuid4()
    event = NotificationEvent(
        event_type="anomaly",
        severity="critical",
        source="office",
        content="Payment gateway connection lost",
        related_decision_id=decision_id,
    )
    assert event.severity == "critical"
    assert event.related_decision_id == decision_id


def test_notification_result():
    result = NotificationResult(
        delivered=True,
        channel="dashboard",
        captain_should_see=True,
    )
    assert result.delivered is True
    assert result.captain_should_see is True


def test_filter_result_present():
    result = FilterResult(
        should_present=True,
        reason="Strategic decision requires Captain approval",
    )
    assert result.should_present is True
    assert result.urgency_override is None
    assert result.auto_action is None


def test_filter_result_auto_action():
    result = FilterResult(
        should_present=False,
        auto_action="Auto-approved: routine execution within budget",
        reason="Matches authorization rule for execution decisions",
    )
    assert result.should_present is False
    assert result.auto_action is not None


def test_filter_result_urgency_override():
    result = FilterResult(
        should_present=True,
        urgency_override="red",
        reason="Anomaly escalated to critical",
    )
    assert result.urgency_override == "red"


def test_greeting_has_fallback_field():
    g = Greeting(captain_id="cap1", message="Hello", auto_processed_summary="", today_highlights=[])
    assert g.fallback is False

    g_fb = Greeting(captain_id="cap1", message="Welcome back", auto_processed_summary="", today_highlights=[], fallback=True)
    assert g_fb.fallback is True


def test_secretary_response_has_fallback_field():
    r = SecretaryResponse(message="Hi", level=SecretaryLevel.L1)
    assert r.fallback is False
