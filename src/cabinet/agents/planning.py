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


import asyncio
import json
from collections.abc import Callable, Awaitable
from unittest.mock import MagicMock


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


def _ready_steps(steps: list[PlanStep]) -> list[PlanStep]:
    """Return steps whose dependencies are all done."""
    done_ids = {s.id for s in steps if s.status == "done"}
    return [s for s in steps if s.status == "pending"
            and all(d in done_ids for d in s.depends_on)]


def _block_dependents(steps: list[PlanStep], failed_ids: set[str]) -> list[PlanStep]:
    """Mark steps that depend on any failed step as blocked."""
    for s in steps:
        if s.status == "pending" and any(d in failed_ids for d in s.depends_on):
            s.status = "blocked"
    return steps


class Executor:
    """Execute PlanSteps respecting dependency DAG. Independent steps run concurrently."""

    def __init__(self, tool_executor: Callable[..., Awaitable[dict]]):
        self._execute_tool = tool_executor

    async def execute(self, steps: list[PlanStep]) -> list[PlanStep]:
        """Execute all steps, respecting dependencies."""
        if not steps:
            return steps

        # Reset statuses
        for s in steps:
            if s.status != "failed":
                s.status = "pending"

        processed: set[str] = set()

        while len(processed) < len(steps):
            ready = _ready_steps(steps)
            if not ready:
                break  # No more steps can run (all remaining are blocked)

            # Independent steps (no deps on each other within this batch)
            independent = [s for s in ready if not any(
                other.id in s.depends_on for other in ready if other.id != s.id
            )]

            if len(independent) > 1:
                async def _run_step(step: PlanStep) -> PlanStep:
                    step.status = "running"
                    try:
                        tc = MagicMock()
                        tc.function.name = step.tool_name or "unknown"
                        result = await self._execute_tool(tc)
                        step.result = str(result)
                        step.status = "done"
                    except Exception as e:
                        step.result = str(e)
                        step.status = "failed"
                    return step

                results = await asyncio.gather(
                    *[_run_step(s) for s in independent], return_exceptions=True
                )
                for i, r in enumerate(results):
                    if isinstance(r, Exception):
                        independent[i].status = "failed"
                        independent[i].result = str(r)
                    processed.add(independent[i].id)
            else:
                for step in ready:
                    step.status = "running"
                    try:
                        tc = MagicMock()
                        tc.function.name = step.tool_name or "unknown"
                        result = await self._execute_tool(tc)
                        step.result = str(result)
                        step.status = "done"
                    except Exception as e:
                        step.result = str(e)
                        step.status = "failed"
                    processed.add(step.id)

            # Block dependents of newly failed
            new_failures = {s.id for s in steps if s.status == "failed" and s.id in processed}
            _block_dependents(steps, new_failures)

            # Mark blocked as processed
            for s in steps:
                if s.status == "blocked" and s.id not in processed:
                    processed.add(s.id)

        return steps


@dataclass
class EvaluationVerdict:
    """Result of plan evaluation."""
    success: bool
    summary: str
    failure_reason: str | None = None


class Evaluator:
    """Evaluate whether plan steps achieved their expected outcomes via LLM."""

    def __init__(self, gateway, model: str = "default"):
        self._gateway = gateway
        self._model = model

    async def evaluate(self, goal: str, steps: list[PlanStep]) -> EvaluationVerdict:
        """Evaluate each done step against expected_outcome."""
        done_steps = [s for s in steps if s.status == "done"]
        if not done_steps:
            return EvaluationVerdict(
                success=False,
                summary="No steps completed",
                failure_reason="All steps are pending or blocked",
            )

        results = []
        failure_reason = None

        for step in done_steps:
            prompt = f"""Compare the expected outcome with the actual result.
Answer ONLY 'MATCH' or 'MISMATCH: <brief reason>'.

Expected: {step.expected_outcome}
Actual: {step.result}"""

            response = await self._gateway.complete(
                messages=[
                    {"role": "system", "content": "You are an outcome evaluator. Compare expected vs actual results. Answer ONLY 'MATCH' or 'MISMATCH: <reason>'."},
                    {"role": "user", "content": prompt},
                ],
                model=self._model,
                temperature=0.1,
            )

            content = response.content.strip()
            if content.startswith("MATCH"):
                results.append(True)
            else:
                results.append(False)
                if failure_reason is None:
                    failure_reason = content.replace("MISMATCH: ", "").strip()

        all_match = all(results)
        done_desc = "\n".join(
            f"- {s.description}: {'PASS' if r else 'FAIL'}"
            for s, r in zip(done_steps, results)
        )

        return EvaluationVerdict(
            success=all_match,
            summary=f"Goal: {goal}\nResults:\n{done_desc}",
            failure_reason=failure_reason if not all_match else None,
        )
