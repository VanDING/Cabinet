from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.agents.context import AgentOutput
from cabinet.core.harness.models import EscalationVerdict, EvaluationResult, GateResult
from cabinet.models.decisions import Decision


@runtime_checkable
class Evaluator(Protocol):
    async def evaluate(self, output: AgentOutput, criteria: list[str]) -> EvaluationResult: ...


@runtime_checkable
class VerificationGate(Protocol):
    async def check(self, node_id: UUID, context: dict) -> GateResult: ...


@runtime_checkable
class EscalationProtocol(Protocol):
    async def should_escalate(self, decision: Decision) -> EscalationVerdict: ...
    async def auto_handle(self, decision: Decision) -> Decision: ...
