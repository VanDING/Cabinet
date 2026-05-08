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


import json


PLANNER_SYSTEM_PROMPT = """You are a task planner. Decompose the user's goal into ordered, actionable steps.
Each step must have:
- description: Human-readable description of what to do
- tool_name: One of {available_tools} or null for free choice
- expected_outcome: Specific, verifiable expected result
- depends_on: List of step indices (0-based) that must complete before this step

Output ONLY valid JSON array of step objects. No explanation, no markdown wrapping.

Example:
[
    {"description": "Read current config", "tool_name": "Read", "expected_outcome": "File contents", "depends_on": []},
    {"description": "Update log level", "tool_name": "Edit", "expected_outcome": "Log level set to DEBUG", "depends_on": [0]}
]
"""


class Planner:
    """Decompose user goals into structured Plan objects via LLM."""

    def __init__(self, gateway, model: str = "default"):
        self._gateway = gateway
        self._model = model

    async def plan(self, goal: str, available_tools: list[str]) -> Plan:
        """Decompose goal into a Plan with ordered PlanSteps."""
        tools_str = ", ".join(available_tools) if available_tools else "any tool"
        prompt = PLANNER_SYSTEM_PROMPT.replace("{available_tools}", tools_str)

        response = await self._gateway.complete(
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": goal},
            ],
            model=self._model,
            temperature=0.3,
        )

        try:
            raw_steps = json.loads(response.content)
        except json.JSONDecodeError:
            # Fallback: single-step plan
            raw_steps = [{
                "description": goal,
                "tool_name": None,
                "expected_outcome": "Task completed",
                "depends_on": [],
            }]

        steps = []
        for i, raw in enumerate(raw_steps):
            step = PlanStep(
                description=raw.get("description", f"Step {i + 1}"),
                expected_outcome=raw.get("expected_outcome", "Done"),
                tool_name=raw.get("tool_name"),
                depends_on=[f"_s{d}_" for d in raw.get("depends_on", [])],
            )
            step.id = f"_s{i}_"
            steps.append(step)

        return Plan(goal=goal, steps=steps)

    async def replan(self, plan: Plan, steps: list[PlanStep],
                     failure_reason: str) -> Plan:
        """Create a new plan from remaining pending steps, given failure context."""
        pending = [s for s in steps if s.status in ("pending", "blocked")]
        if not pending:
            return plan

        done_descriptions = "\n".join(
            f"- {s.description}: {s.result}" for s in steps if s.status == "done"
        )

        replan_prompt = f"""Replan the remaining steps given the failure.
Goal: {plan.goal}
Failure: {failure_reason}
Completed steps:
{done_descriptions or 'None'}
Remaining steps to replan:
{chr(10).join(f"- {s.description}" for s in pending)}

Output ONLY valid JSON array of replacement step objects (same format as planning)."""

        response = await self._gateway.complete(
            messages=[
                {"role": "system", "content": PLANNER_SYSTEM_PROMPT.replace("{available_tools}", "any")},
                {"role": "user", "content": replan_prompt},
            ],
            model=self._model,
            temperature=0.3,
        )

        try:
            raw_steps = json.loads(response.content)
            new_steps = []
            for i, raw in enumerate(raw_steps):
                step = PlanStep(
                    description=raw.get("description", f"Replan step {i + 1}"),
                    expected_outcome=raw.get("expected_outcome", "Done"),
                    tool_name=raw.get("tool_name"),
                    depends_on=raw.get("depends_on", []),
                )
                new_steps.append(step)
            plan.steps = new_steps
        except json.JSONDecodeError:
            pass  # Keep existing plan on parse failure

        return plan
