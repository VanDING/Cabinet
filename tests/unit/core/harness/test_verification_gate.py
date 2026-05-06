import uuid

import pytest

from cabinet.core.harness.models import EvaluationResult, GateResult
from cabinet.core.harness.verification_gate import WorkflowVerificationGate


def test_workflow_verification_gate_satisfies_protocol():
    from cabinet.core.harness.protocol import VerificationGate
    gate = WorkflowVerificationGate(evaluator=None)
    assert isinstance(gate, VerificationGate)


@pytest.mark.asyncio
async def test_verification_gate_passes():
    gate = WorkflowVerificationGate(evaluator=None)
    result = await gate.check(uuid.uuid4(), {"output": "test"})
    assert isinstance(result, GateResult)
    assert result.passed is True


@pytest.mark.asyncio
async def test_verification_gate_with_evaluator_passes():
    class MockEvaluator:
        async def evaluate(self, output, criteria):
            return EvaluationResult(passed=True, score=0.95)

    gate = WorkflowVerificationGate(evaluator=MockEvaluator())
    result = await gate.check(uuid.uuid4(), {"output": "good output", "criteria": ["quality"]})
    assert result.passed is True


@pytest.mark.asyncio
async def test_verification_gate_with_evaluator_fails():
    class MockEvaluator:
        async def evaluate(self, output, criteria):
            return EvaluationResult(passed=False, score=0.3, issues=["Quality below threshold"])

    gate = WorkflowVerificationGate(evaluator=MockEvaluator())
    result = await gate.check(uuid.uuid4(), {"output": "poor output", "criteria": ["quality"]})
    assert result.passed is False
    assert result.retry_allowed is True
    assert result.reason is not None
