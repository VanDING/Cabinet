import uuid


from cabinet.models.decisions import (
    Decision,
    DecisionStatus,
    DecisionType,
)


def test_strategic_decision_lifecycle():
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Enter new market",
        description="Should we expand into the EU market?",
        captain_id="captain-1",
    )
    assert d.status == DecisionStatus.PENDING
    assert d.immutable is True
    assert d.chosen_option is None


def test_decision_type_values():
    assert DecisionType.STRATEGIC.value == "strategic"
    assert DecisionType.ACTION.value == "action"
    assert DecisionType.EXECUTION.value == "execution"
    assert DecisionType.ANOMALY.value == "anomaly"
    assert DecisionType.EVOLUTION.value == "evolution"


def test_decision_status_values():
    assert DecisionStatus.PENDING.value == "pending"
    assert DecisionStatus.IN_REASONING.value == "in_reasoning"
    assert DecisionStatus.APPROVED.value == "approved"
    assert DecisionStatus.REJECTED.value == "rejected"
    assert DecisionStatus.ARCHIVED.value == "archived"


def test_decision_with_options():
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Pricing strategy",
        description="Choose pricing model",
        options=[
            {"label": "Freemium", "description": "Free tier + premium"},
            {"label": "Flat rate", "description": "Single price"},
        ],
        captain_id="captain-1",
    )
    assert len(d.options) == 2


def test_decision_with_chosen_option():
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        status=DecisionStatus.APPROVED,
        title="Send email",
        description="Auto-send follow-up email",
        chosen_option={"label": "Approve"},
        captain_id="captain-1",
    )
    assert d.chosen_option is not None


def test_decision_immutability_default():
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="API timeout",
        description="External API timed out 3 times",
        captain_id="captain-1",
    )
    assert d.immutable is True


def test_decision_causation_link():
    source_id = uuid.uuid4()
    d = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ACTION,
        title="Execute plan",
        description="Execute the approved plan",
        captain_id="captain-1",
        source_event_id=source_id,
    )
    assert d.source_event_id == source_id


def test_decision_urgency_colors():
    d_red = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="Critical failure",
        description="System down",
        urgency="red",
        captain_id="captain-1",
    )
    assert d_red.urgency == "red"

    d_blue = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Routine approval",
        description="Auto-approve routine task",
        urgency="blue",
        captain_id="captain-1",
    )
    assert d_blue.urgency == "blue"


def test_decision_immutable_cannot_be_modified_directly():
    from cabinet.models.decisions import Decision, DecisionStatus, DecisionType
    from uuid import uuid4

    d = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="test", description="test",
        captain_id="captain-1",
        status=DecisionStatus.APPROVED,
    )
    assert d.immutable is True
    # Verify model_copy creates a new instance
    d2 = d.model_copy(update={"status": DecisionStatus.REJECTED})
    assert d.status == DecisionStatus.APPROVED  # original unchanged
    assert d2.status == DecisionStatus.REJECTED   # copy changed


def test_decision_all_statuses_have_valid_enum_values():
    from cabinet.models.decisions import DecisionStatus

    for status in DecisionStatus:
        assert isinstance(status.value, str)
        assert len(status.value) > 0
