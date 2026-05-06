import uuid

import pytest

from cabinet.core.harness.escalation import DefaultEscalationProtocol
from cabinet.models.decisions import Decision, DecisionStatus, DecisionType
from cabinet.rooms.decision.models import AuthorizationRule


def test_default_escalation_satisfies_protocol():
    from cabinet.core.harness.protocol import EscalationProtocol
    protocol = DefaultEscalationProtocol(rules=[])
    assert isinstance(protocol, EscalationProtocol)


@pytest.mark.asyncio
async def test_escalation_strategic_always_escalates():
    protocol = DefaultEscalationProtocol(rules=[])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Market direction",
        description="Which market to enter",
        captain_id="captain-1",
    )
    verdict = await protocol.should_escalate(decision)
    assert verdict.escalate is True
    assert "strategic" in verdict.reason.lower()


@pytest.mark.asyncio
async def test_escalation_anomaly_escalates():
    protocol = DefaultEscalationProtocol(rules=[])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="System failure",
        description="Critical system failure",
        captain_id="captain-1",
        urgency="red",
    )
    verdict = await protocol.should_escalate(decision)
    assert verdict.escalate is True


@pytest.mark.asyncio
async def test_escalation_execution_with_auto_approve_rule():
    rule = AuthorizationRule(
        captain_id="captain-1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
    )
    protocol = DefaultEscalationProtocol(rules=[rule])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Send email",
        description="Routine email",
        captain_id="captain-1",
    )
    verdict = await protocol.should_escalate(decision)
    assert verdict.escalate is False
    assert verdict.auto_action is not None


@pytest.mark.asyncio
async def test_escalation_execution_no_rule():
    protocol = DefaultEscalationProtocol(rules=[])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Approve budget",
        description="Budget approval",
        captain_id="captain-1",
    )
    verdict = await protocol.should_escalate(decision)
    assert verdict.escalate is True


@pytest.mark.asyncio
async def test_escalation_auto_handle():
    rule = AuthorizationRule(
        captain_id="captain-1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
    )
    protocol = DefaultEscalationProtocol(rules=[rule])
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Auto task",
        description="Routine",
        captain_id="captain-1",
    )
    result = await protocol.auto_handle(decision)
    assert result.id == decision.id
    assert result.status == DecisionStatus.APPROVED
