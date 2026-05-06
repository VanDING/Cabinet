from __future__ import annotations

from pydantic import BaseModel


class EvaluationResult(BaseModel):
    passed: bool
    score: float
    issues: list[str] = []
    suggestions: list[str] = []


class GateResult(BaseModel):
    passed: bool
    reason: str | None = None
    retry_allowed: bool = True


class EscalationVerdict(BaseModel):
    escalate: bool
    reason: str
    auto_action: str | None = None
