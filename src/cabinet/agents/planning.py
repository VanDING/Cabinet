from __future__ import annotations

from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class PlanStep:
    """A single step in an agent's execution plan."""
    description: str
    expected_outcome: str
    tool_name: str | None = None
    depends_on: list[str] = field(default_factory=list)
    id: str = field(default_factory=lambda: uuid4().hex[:8])
    result: str | None = None
    status: str = "pending"  # pending | running | done | failed | blocked


@dataclass
class Plan:
    """A structured plan decomposing a user goal into ordered steps."""
    goal: str
    steps: list[PlanStep]
    max_replans: int = 3
    replan_count: int = 0
