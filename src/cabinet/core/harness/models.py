from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

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


class JudgeDecision(BaseModel):
    level: Literal["L0", "L1", "L2", "L3"]
    action: str
    reasoning: str
    suggestion: str | None = None
    fallback: dict | None = None


class JudgeLog(BaseModel):
    node_id: UUID
    scenario: str
    rule_triggered: str | None
    level: str
    action: str
    reasoning: str
    timestamp: datetime
