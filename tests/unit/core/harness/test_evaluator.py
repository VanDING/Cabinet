import uuid

import pytest

from cabinet.agents.context import AgentOutput
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.core.harness.evaluator import DefaultEvaluator
from cabinet.core.harness.models import EvaluationResult


def test_default_evaluator_satisfies_protocol():
    from cabinet.core.harness.protocol import Evaluator
    evaluator = DefaultEvaluator(gateway=None)
    assert isinstance(evaluator, Evaluator)


@pytest.mark.asyncio
async def test_default_evaluator_evaluate_passes():
    from unittest.mock import AsyncMock

    gateway = AsyncMock(spec=ModelGateway)
    gateway.complete = AsyncMock()
    gateway.complete.return_value = type("Resp", (), {"content": '{"passed": true, "score": 0.9, "issues": [], "suggestions": []}'})()

    evaluator = DefaultEvaluator(gateway=gateway)
    output = AgentOutput(content="Quality output", employee_id=uuid.uuid4())
    result = await evaluator.evaluate(output, ["accuracy", "completeness"])
    assert isinstance(result, EvaluationResult)
    assert result.passed is True
    assert result.score == 0.9


@pytest.mark.asyncio
async def test_default_evaluator_evaluate_fails():
    from unittest.mock import AsyncMock

    gateway = AsyncMock(spec=ModelGateway)
    gateway.complete = AsyncMock()
    gateway.complete.return_value = type("Resp", (), {"content": '{"passed": false, "score": 0.3, "issues": ["Missing key data"], "suggestions": ["Add supporting evidence"]}'})()

    evaluator = DefaultEvaluator(gateway=gateway)
    output = AgentOutput(content="Incomplete output", employee_id=uuid.uuid4())
    result = await evaluator.evaluate(output, ["accuracy"])
    assert result.passed is False
    assert len(result.issues) == 1
