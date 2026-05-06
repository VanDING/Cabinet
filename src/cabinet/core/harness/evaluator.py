from __future__ import annotations

import json
from typing import TYPE_CHECKING

from cabinet.agents.context import AgentOutput
from cabinet.core.harness.models import EvaluationResult

if TYPE_CHECKING:
    from cabinet.core.gateway.protocol import ModelGateway


class DefaultEvaluator:
    def __init__(self, gateway: ModelGateway | None = None):
        self._gateway = gateway

    async def evaluate(self, output: AgentOutput, criteria: list[str]) -> EvaluationResult:
        if self._gateway is None:
            return EvaluationResult(
                passed=True,
                score=1.0,
                issues=[],
                suggestions=[],
            )

        criteria_text = ", ".join(criteria)
        prompt = (
            f"Evaluate the following output against these criteria: {criteria_text}.\n"
            f"Output: {output.content}\n\n"
            f'Respond with JSON: {{"passed": bool, "score": float, "issues": [str], "suggestions": [str]}}'
        )
        response = await self._gateway.complete(
            messages=[{"role": "user", "content": prompt}],
            model="default",
        )
        try:
            data = json.loads(response.content)
            return EvaluationResult(
                passed=data.get("passed", False),
                score=data.get("score", 0.0),
                issues=data.get("issues", []),
                suggestions=data.get("suggestions", []),
            )
        except (json.JSONDecodeError, KeyError):
            return EvaluationResult(
                passed=False,
                score=0.0,
                issues=["Failed to parse evaluation response"],
                suggestions=[],
            )
