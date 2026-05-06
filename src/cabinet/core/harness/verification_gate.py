from __future__ import annotations

import uuid
from typing import TYPE_CHECKING
from uuid import UUID

from cabinet.agents.context import AgentOutput
from cabinet.core.harness.models import GateResult

if TYPE_CHECKING:
    from cabinet.core.harness.protocol import Evaluator


class WorkflowVerificationGate:
    def __init__(self, evaluator: Evaluator | None = None):
        self._evaluator = evaluator

    async def check(self, node_id: UUID, context: dict) -> GateResult:
        if self._evaluator is None:
            return GateResult(passed=True)

        output_text = context.get("output", "")
        criteria = context.get("criteria", [])
        if not criteria:
            return GateResult(passed=True)

        output = AgentOutput(
            content=output_text, employee_id=context.get("employee_id", uuid.uuid4())
        )
        result = await self._evaluator.evaluate(output, criteria)

        if result.passed:
            return GateResult(passed=True)

        reason = "; ".join(result.issues) if result.issues else "Quality check failed"
        return GateResult(
            passed=False,
            reason=reason,
            retry_allowed=True,
        )
