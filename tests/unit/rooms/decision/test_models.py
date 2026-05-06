import uuid

from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.decision.models import (
    AuthorizationRule,
    AuthorizationVerdict,
    DecisionCard,
    DecisionDashboard,
)


def test_decision_card_creation():
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Market Expansion",
        description="Should we expand to Europe?",
        captain_id="captain-1",
        urgency="yellow",
    )
    card = DecisionCard(
        decision=decision,
        urgency_color="yellow",
        summary="Strategic decision on market expansion",
        options_summary=["Expand now", "Wait for Q3", "Skip Europe"],
        source_room="meeting",
        created_ago="2 hours ago",
    )
    assert card.urgency_color == "yellow"
    assert card.source_room == "meeting"
    assert len(card.options_summary) == 3


def test_decision_dashboard():
    proj_id = uuid.uuid4()
    dashboard = DecisionDashboard(
        project_id=proj_id,
        red_cards=[],
        yellow_cards=[],
        blue_cards=[],
        white_cards=[],
        total_pending=0,
    )
    assert dashboard.total_pending == 0
    assert dashboard.red_cards == []


def test_decision_dashboard_with_cards():
    proj_id = uuid.uuid4()
    decision = Decision(
        project_id=proj_id,
        decision_type=DecisionType.ANOMALY,
        title="API Down",
        description="External API is down",
        captain_id="captain-1",
        urgency="red",
    )
    card = DecisionCard(
        decision=decision,
        urgency_color="red",
        summary="API outage detected",
        options_summary=["Retry", "Switch provider"],
        source_room="office",
        created_ago="5 min ago",
    )
    dashboard = DecisionDashboard(
        project_id=proj_id,
        red_cards=[card],
        yellow_cards=[],
        blue_cards=[],
        white_cards=[],
        total_pending=1,
    )
    assert len(dashboard.red_cards) == 1
    assert dashboard.total_pending == 1


def test_authorization_rule_auto_approve():
    rule = AuthorizationRule(
        captain_id="captain-1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
        conditions=[],
    )
    assert rule.auto_approve is True
    assert rule.budget_threshold is None
    assert rule.notify_only is False


def test_authorization_rule_with_conditions():
    rule = AuthorizationRule(
        captain_id="captain-1",
        decision_type=DecisionType.ACTION,
        auto_approve=False,
        conditions=["budget_exceeded", "external_commitment"],
        budget_threshold=10000.0,
        notify_only=True,
    )
    assert rule.auto_approve is False
    assert rule.budget_threshold == 10000.0
    assert rule.notify_only is True
    assert len(rule.conditions) == 2


def test_authorization_verdict_auto_process():
    verdict = AuthorizationVerdict(
        auto_process=True,
        requires_captain=False,
        reason="Within authorized budget",
        matched_rule=uuid.uuid4(),
    )
    assert verdict.auto_process is True
    assert verdict.requires_captain is False
    assert verdict.matched_rule is not None


def test_authorization_verdict_requires_captain():
    verdict = AuthorizationVerdict(
        auto_process=False,
        requires_captain=True,
        reason="High-risk operation",
    )
    assert verdict.auto_process is False
    assert verdict.requires_captain is True
    assert verdict.matched_rule is None
