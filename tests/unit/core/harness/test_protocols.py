import uuid

import pytest

from cabinet.agents.context import AgentOutput
from cabinet.core.harness.models import EscalationVerdict, EvaluationResult, GateResult
from cabinet.core.harness.protocol import EscalationProtocol, Evaluator, VerificationGate
from cabinet.models.decisions import Decision, DecisionType


def test_evaluator_protocol_runtime_checkable():
    class MockEvaluator:
        async def evaluate(self, output, criteria):
            return EvaluationResult(passed=True, score=1.0)

    mock = MockEvaluator()
    assert isinstance(mock, Evaluator)


def test_verification_gate_protocol_runtime_checkable():
    class MockGate:
        async def check(self, node_id, context):
            return GateResult(passed=True)

    mock = MockGate()
    assert isinstance(mock, VerificationGate)


def test_escalation_protocol_runtime_checkable():
    class MockEscalation:
        async def should_escalate(self, decision):
            return EscalationVerdict(escalate=False, reason="ok")

        async def auto_handle(self, decision):
            return decision

    mock = MockEscalation()
    assert isinstance(mock, EscalationProtocol)


@pytest.mark.asyncio
async def test_evaluator_evaluate_contract():
    class MockEvaluator:
        async def evaluate(self, output, criteria):
            return EvaluationResult(
                passed=True,
                score=0.9,
                issues=[],
                suggestions=["Consider adding more detail"],
            )

    evaluator = MockEvaluator()
    output = AgentOutput(content="Test output", employee_id=uuid.uuid4())
    result = await evaluator.evaluate(output, ["accuracy", "completeness"])
    assert isinstance(result, EvaluationResult)
    assert result.passed is True


@pytest.mark.asyncio
async def test_verification_gate_check_contract():
    class MockGate:
        async def check(self, node_id, context):
            return GateResult(passed=False, reason="Quality below threshold", retry_allowed=True)

    gate = MockGate()
    result = await gate.check(uuid.uuid4(), {"output": "test"})
    assert isinstance(result, GateResult)
    assert result.passed is False


@pytest.mark.asyncio
async def test_escalation_protocol_should_escalate_contract():
    class MockEscalation:
        async def should_escalate(self, decision):
            return EscalationVerdict(escalate=True, reason="High risk")

        async def auto_handle(self, decision):
            return decision

    protocol = MockEscalation()
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="API timeout",
        description="External API timed out 3 times",
        captain_id="captain-1",
    )
    verdict = await protocol.should_escalate(decision)
    assert isinstance(verdict, EscalationVerdict)
    assert verdict.escalate is True


@pytest.mark.asyncio
async def test_escalation_protocol_auto_handle_contract():
    class MockEscalation:
        async def should_escalate(self, decision):
            return EscalationVerdict(escalate=False, reason="ok")

        async def auto_handle(self, decision):
            return decision

    protocol = MockEscalation()
    decision = Decision(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="Auto-approve",
        description="Routine task",
        captain_id="captain-1",
    )
    result = await protocol.auto_handle(decision)
    assert result.id == decision.id
