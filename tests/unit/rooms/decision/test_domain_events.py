from uuid import uuid4

from cabinet.models.decisions import DecisionType
from cabinet.rooms.decision.domain_events import (
    AuthorizationRuleSet,
    DecisionApproved,
    DecisionCascaded,
    DecisionDelegated,
    DecisionRejected,
    DecisionSubmitted,
)


def test_decision_submitted_creation():
    event = DecisionSubmitted(
        decision_id=uuid4(), project_id=uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="hire", description="hire someone",
        options=[{"label": "yes"}], captain_id="cap1",
        source_event_id=None,
    )
    assert event.decision_type == DecisionType.STRATEGIC
    assert event.title == "hire"


def test_decision_approved_creation():
    event = DecisionApproved(
        decision_id=uuid4(), chosen_option={"action": "go"},
    )
    assert event.chosen_option["action"] == "go"


def test_decision_rejected_creation():
    event = DecisionRejected(decision_id=uuid4(), reason="too risky")
    assert event.reason == "too risky"


def test_decision_delegated_creation():
    event = DecisionDelegated(decision_id=uuid4(), delegate_to="agent-1")
    assert event.delegate_to == "agent-1"


def test_authorization_rule_set_creation():
    event = AuthorizationRuleSet(
        rule_id=uuid4(), captain_id="cap1",
        decision_type=DecisionType.ACTION,
        auto_approve=True, conditions=["budget < 1000"],
    )
    assert event.auto_approve is True


def test_decision_cascaded_creation():
    parent = uuid4()
    child1 = uuid4()
    child2 = uuid4()
    event = DecisionCascaded(
        parent_decision_id=parent, child_decision_ids=[child1, child2],
    )
    assert len(event.child_decision_ids) == 2
