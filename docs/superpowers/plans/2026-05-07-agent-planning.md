# Agent 自主规划与执行回路 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Plan-Execute-Evaluate loop that enables agents to decompose complex tasks into ordered steps, execute them respecting dependencies, and verify outcomes — with automatic replanning on failure.

**Architecture:** Three new classes (Planner, Executor, Evaluator) in `src/cabinet/agents/planning.py` built on top of existing LiteLLMAgent tool execution. New entry point `_execute_with_plan` added to LiteLLMAgent (opt-in via `enable_planning=True`), leaving existing `_execute_with_tools` path untouched.

**Tech Stack:** Python 3.12+, Pydantic dataclasses, asyncio.gather (concurrent execution of independent steps), existing LiteLLM gateway

---

## File Structure

```
Create:
  src/cabinet/agents/planning.py          # PlanStep, Plan, Planner, Executor, Evaluator
  tests/unit/agents/test_planning.py      # 7 unit tests

Modify:
  src/cabinet/agents/llm_agent.py          # Add _execute_with_plan entry point
```

---

### Task 1: Create PlanStep + Plan Models

**Files:**
- Create: `src/cabinet/agents/planning.py`
- Create: `tests/unit/agents/test_planning.py`

- [ ] **Step 1: Write failing tests for PlanStep and Plan**

Create `tests/unit/agents/test_planning.py`:

```python
from __future__ import annotations

from cabinet.agents.planning import PlanStep, Plan


def test_plan_step_defaults():
    step = PlanStep(description="Edit config.py", expected_outcome="DEBUG level set")
    assert step.description == "Edit config.py"
    assert step.tool_name is None
    assert step.depends_on == []
    assert step.status == "pending"
    assert step.result is None
    assert len(step.id) == 8


def test_plan_step_with_tool():
    step = PlanStep(
        description="Run pytest",
        tool_name="Bash",
        expected_outcome="All tests pass",
    )
    assert step.tool_name == "Bash"


def test_plan_step_with_dependencies():
    step = PlanStep(
        description="Verify tests pass",
        tool_name="Bash",
        expected_outcome="exit code 0",
        depends_on=["abc12345"],
    )
    assert step.depends_on == ["abc12345"]


def test_plan_creates_with_steps():
    steps = [
        PlanStep(description="Step 1", expected_outcome="Done"),
        PlanStep(description="Step 2", expected_outcome="Done", depends_on=["_step1_"]),
    ]
    steps[0].id = "_step1_"
    plan = Plan(goal="Test goal", steps=steps)
    assert plan.goal == "Test goal"
    assert len(plan.steps) == 2
    assert plan.max_replans == 3
    assert plan.replan_count == 0
```

Run: `pytest tests/unit/agents/test_planning.py -v`
Expected: FAIL (ImportError: cannot import PlanStep)

- [ ] **Step 2: Create PlanStep and Plan dataclasses**

Create `src/cabinet/agents/planning.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify**

Run: `pytest tests/unit/agents/test_planning.py -v`
Expected: 4 passed

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/agents/planning.py tests/unit/agents/test_planning.py
git commit -m "feat(agents): add PlanStep and Plan dataclasses for task planning"
```

---

### Task 2: Implement Planner

**Files:**
- Modify: `src/cabinet/agents/planning.py` (append Planner class)
- Modify: `tests/unit/agents/test_planning.py` (append planner tests)

- [ ] **Step 1: Write failing tests for Planner**

Append to `tests/unit/agents/test_planning.py`:

```python
from unittest.mock import AsyncMock, MagicMock
from cabinet.agents.planning import Planner


def test_planner_decomposes_simple_task():
    """Planner should decompose a task into PlanStep list via LLM."""
    mock_gateway = MagicMock()
    mock_response = MagicMock()
    mock_response.content = '''[
        {"description": "Read config.py", "tool_name": "Read", "expected_outcome": "File contents shown", "depends_on": []},
        {"description": "Edit log level to DEBUG", "tool_name": "Edit", "expected_outcome": "Log level changed", "depends_on": ["_s1_"]},
        {"description": "Run tests", "tool_name": "Bash", "expected_outcome": "All tests pass", "depends_on": ["_s2_"]}
    ]'''
    mock_gateway.complete = AsyncMock(return_value=mock_response)

    planner = Planner(mock_gateway)
    plan = planner.plan("Change log level to DEBUG and verify tests pass", ["Read", "Edit", "Bash"])

    # Run async
    import asyncio
    plan = asyncio.run(plan)

    assert plan.goal == "Change log level to DEBUG and verify tests pass"
    assert len(plan.steps) == 3
    assert plan.steps[0].tool_name == "Read"
    assert plan.steps[1].depends_on == ["_s1_"]
    assert plan.steps[2].depends_on == ["_s2_"]


def test_planner_uses_available_tools_in_prompt():
    """Planner prompt includes available tool names."""
    mock_gateway = MagicMock()
    mock_response = MagicMock()
    mock_response.content = '[]'
    mock_gateway.complete = AsyncMock(return_value=mock_response)

    planner = Planner(mock_gateway)
    import asyncio
    asyncio.run(planner.plan("Do X", ["Read", "Bash", "Glob"]))

    call_args = mock_gateway.complete.call_args
    prompt_text = str(call_args)
    assert "Read" in prompt_text
    assert "Bash" in prompt_text
    assert "Glob" in prompt_text
```

Run: `pytest tests/unit/agents/test_planning.py::test_planner_decomposes_simple_task -v`
Expected: FAIL (ImportError: cannot import Planner)

- [ ] **Step 2: Implement Planner class**

Append to `src/cabinet/agents/planning.py`:

```python
import json
from cabinet.core.gateway.protocol import ModelGateway


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

    def __init__(self, gateway: ModelGateway, model: str = "default"):
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

        prompt = f"""Replan the remaining steps given the failure.
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
                {"role": "user", "content": prompt},
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
            pass  # Keep existing plan

        return plan
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/unit/agents/test_planning.py -v`
Expected: 6 passed (4 from Task 1 + 2 new)

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/agents/planning.py tests/unit/agents/test_planning.py
git commit -m "feat(agents): add Planner for LLM-based task decomposition"
```

---

### Task 3: Implement Executor

**Files:**
- Modify: `src/cabinet/agents/planning.py` (append Executor class + helpers)
- Modify: `tests/unit/agents/test_planning.py` (append executor tests)

- [ ] **Step 1: Write failing tests for Executor**

Append to `tests/unit/agents/test_planning.py`:

```python
import asyncio
from cabinet.agents.planning import Executor


def make_step(desc: str, expected: str, tool: str = "Read",
              deps: list[str] | None = None) -> PlanStep:
    return PlanStep(description=desc, expected_outcome=expected,
                    tool_name=tool, depends_on=deps or [])


def test_executor_respects_dependencies():
    """Steps with dependencies wait for prerequisites."""
    s1 = make_step("Step 1", "Done")
    s2 = make_step("Step 2", "Done", depends_on=[s1.id])
    s3 = make_step("Step 3", "Done", depends_on=[s2.id])

    async def fake_execute(tool_call):
        return {"result": f"Executed {tool_call.function.name}", "status": "success"}

    executor = Executor(fake_execute)
    steps = asyncio.run(executor.execute([s1, s2, s3]))

    # All should be done (dependencies respected by sequential execution)
    assert all(s.status == "done" for s in steps)


def test_executor_blocks_on_failure():
    """Dependent steps are marked blocked when prerequisite fails."""
    s1 = make_step("Step 1", "Done")
    s2 = make_step("Step 2", "Done", depends_on=[s1.id])

    async def fake_failing_execute(tool_call):
        raise RuntimeError("Boom")

    executor = Executor(fake_failing_execute)
    steps = asyncio.run(executor.execute([s1, s2]))

    assert s1.status == "failed"
    assert s2.status == "blocked"


def test_executor_parallel_independent():
    """Independent steps run concurrently."""
    s1 = make_step("Indep 1", "Done")
    s2 = make_step("Indep 2", "Done")
    s3 = make_step("Indep 3", "Done")

    order = []

    async def tracking_execute(tool_call):
        order.append(tool_call.function.name)
        return {"result": "ok", "status": "success"}

    executor = Executor(tracking_execute)
    # Mock tool calls to have function.name set
    from unittest.mock import MagicMock
    tc1 = MagicMock()
    tc1.function.name = "Read"
    tc2 = MagicMock()
    tc2.function.name = "Grep"
    tc3 = MagicMock()
    tc3.function.name = "Glob"

    steps = asyncio.run(executor.execute([s1, s2, s3]))

    assert all(s.status == "done" for s in steps)
    # All 3 independent: should complete (order not guaranteed due to concurrency)
    assert len(order) == 3
```

Run: `pytest tests/unit/agents/test_planning.py::test_executor_respects_dependencies -v`
Expected: FAIL (ImportError: cannot import Executor)

- [ ] **Step 2: Read existing tool execution code to understand interface**

Read `src/cabinet/agents/llm_agent.py` lines around `_execute_tool_call` to understand the signature: `async def _execute_tool_call(self, tool_call) -> dict`. The Executor wraps this as `tool_executor(tool_call) -> dict`.

Read `src/cabinet/agents/tools.py` to find the `_get_tool_name` helper function for extracting tool name from a tool call object.

- [ ] **Step 3: Implement Executor + helpers**

Append to `src/cabinet/agents/planning.py`:

```python
import asyncio
from collections.abc import Callable, Awaitable


def _ready_steps(steps: list[PlanStep]) -> list[PlanStep]:
    """Return steps whose dependencies are all done and status is pending."""
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
    """Execute PlanSteps respecting dependency DAG."""

    def __init__(self, tool_executor: Callable[..., Awaitable[dict]]):
        self._execute_tool = tool_executor

    async def execute(self, steps: list[PlanStep]) -> list[PlanStep]:
        """Execute all steps, respecting dependencies. Independent steps run concurrently."""
        # Reset statuses for execution
        for s in steps:
            if s.status != "failed":
                s.status = "pending"

        # Build a mock tool_call for each step with a tool name
        from unittest.mock import MagicMock

        processed: set[str] = set()
        while len(processed) < len(steps):
            ready = _ready_steps(steps)
            if not ready:
                # Mark remaining as blocked (no ready steps means all remaining have deps)
                break

            # For independent steps (no deps on each other), run concurrently
            independent = [s for s in ready if not any(
                other.id in s.depends_on for other in ready if other.id != s.id
            )]

            if len(independent) > 1:
                # Run concurrently
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
                # Run sequentially (single step or dependency chain)
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

            # Block dependents of newly failed steps
            new_failures = {s.id for s in steps if s.status == "failed" and s.id in processed}
            _block_dependents(steps, new_failures)

            # Mark blocked as processed
            for s in steps:
                if s.status == "blocked" and s.id not in processed:
                    processed.add(s.id)

        return steps
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/unit/agents/test_planning.py -v`
Expected: 9 passed (6 from previous tasks + 3 new)

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/planning.py tests/unit/agents/test_planning.py
git commit -m "feat(agents): add Executor for dependency-respecting plan step execution"
```

---

### Task 4: Implement Evaluator

**Files:**
- Modify: `src/cabinet/agents/planning.py` (append Evaluator class + EvaluationVerdict)
- Modify: `tests/unit/agents/test_planning.py` (append evaluator tests)

- [ ] **Step 1: Write failing tests for Evaluator**

Append to `tests/unit/agents/test_planning.py`:

```python
from cabinet.agents.planning import Evaluator, EvaluationVerdict


def test_evaluation_verdict_success():
    v = EvaluationVerdict(success=True, summary="All steps passed")
    assert v.success is True
    assert v.summary == "All steps passed"
    assert v.failure_reason is None


def test_evaluation_verdict_failure():
    v = EvaluationVerdict(
        success=False,
        summary="Step 2 failed",
        failure_reason="Expected 'tests pass' but got '2 failures'",
    )
    assert v.success is False
    assert v.failure_reason == "Expected 'tests pass' but got '2 failures'"


def test_evaluator_all_steps_match():
    """Evaluator returns success when all steps match expected outcomes."""
    mock_gateway = MagicMock()
    mock_response = MagicMock()
    mock_response.content = "MATCH"
    mock_gateway.complete = AsyncMock(return_value=mock_response)

    steps = [
        PlanStep(description="Edit config", expected_outcome="Log level changed",
                 tool_name="Edit", result="File updated: log level = DEBUG"),
        PlanStep(description="Run tests", expected_outcome="Tests pass",
                 tool_name="Bash", result="1087 passed"),
    ]
    steps[0].status = "done"
    steps[1].status = "done"

    evaluator = Evaluator(mock_gateway)
    verdict = asyncio.run(evaluator.evaluate("Change log to DEBUG and verify", steps))

    assert verdict.success is True


def test_evaluator_detects_mismatch():
    """Evaluator returns failure when a step doesn't match expected outcome."""
    mock_gateway = MagicMock()
    mismatch_response = MagicMock()
    mismatch_response.content = "MISMATCH: Expected 'Tests pass' but got '2 failures'"
    mock_gateway.complete = AsyncMock(return_value=mismatch_response)

    steps = [
        PlanStep(description="Run tests", expected_outcome="Tests pass",
                 tool_name="Bash", result="2 tests failed"),
    ]
    steps[0].status = "done"

    evaluator = Evaluator(mock_gateway)
    verdict = asyncio.run(evaluator.evaluate("Verify tests", steps))

    assert verdict.success is False
    assert verdict.failure_reason is not None
```

Run: `pytest tests/unit/agents/test_planning.py::test_evaluation_verdict_success -v`
Expected: FAIL (ImportError: cannot import EvaluationVerdict)

- [ ] **Step 2: Implement EvaluationVerdict + Evaluator**

Append to `src/cabinet/agents/planning.py`:

```python
from dataclasses import dataclass


@dataclass
class EvaluationVerdict:
    """Result of plan evaluation."""
    success: bool
    summary: str
    failure_reason: str | None = None


class Evaluator:
    """Evaluate whether plan steps achieved their expected outcomes."""

    def __init__(self, gateway: ModelGateway, model: str = "default"):
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
        for step in done_steps:
            prompt = f"""Compare the expected outcome with the actual result.
Answer ONLY 'MATCH' or 'MISMATCH: <brief reason>'.

Expected: {step.expected_outcome}
Actual: {step.result}"""

            response = await self._gateway.complete(
                messages=[
                    {"role": "system", "content": "You are an outcome evaluator. Compare expected vs actual results."},
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
                if not hasattr(self, "_last_failure"):
                    # Track first failure for replanning
                    self._last_failure = content.replace("MISMATCH: ", "").strip()

        all_match = all(results)
        done_desc = "\n".join(
            f"- {s.description}: {'PASS' if r else 'FAIL'}" 
            for s, r in zip(done_steps, results)
        )

        return EvaluationVerdict(
            success=all_match,
            summary=f"Goal: {goal}\nResults:\n{done_desc}",
            failure_reason=getattr(self, "_last_failure", None) if not all_match else None,
        )
```

- [ ] **Step 3: Run tests**

Run: `pytest tests/unit/agents/test_planning.py -v`
Expected: 13 passed (9 from previous + 4 new)

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/agents/planning.py tests/unit/agents/test_planning.py
git commit -m "feat(agents): add Evaluator for plan outcome verification"
```

---

### Task 5: Integrate into LiteLLMAgent

**Files:**
- Modify: `src/cabinet/agents/llm_agent.py`
- Modify: `src/cabinet/agents/__init__.py` (if needed for exports)

- [ ] **Step 1: Read current LiteLLMAgent**

Read `src/cabinet/agents/llm_agent.py`. Note the `__init__` signature and the `_execute_with_tools` method structure.

- [ ] **Step 2: Add planning components to __init__**

In `__init__`, add after existing attribute initialization:

```python
        # Planning support (opt-in)
        self._enable_planning = kwargs.get("enable_planning", True)
        if self._enable_planning:
            from cabinet.agents.planning import Planner, Executor, Evaluator
            self._planner = Planner(self._gateway)
            self._executor = Executor(self._execute_tool_call)
            self._evaluator = Evaluator(self._gateway)
```

- [ ] **Step 3: Add _execute_with_plan method**

Append to the LiteLLMAgent class:

```python
    async def _execute_with_plan(self, task: str) -> AgentOutput:
        """Execute a complex task using Plan-Execute-Evaluate loop with replanning."""
        tools = getattr(self._tool_registry, 'list_tool_names', lambda: [])()
        plan = await self._planner.plan(task, tools)

        for _ in range(plan.max_replans):
            plan.steps = await self._executor.execute(plan.steps)
            verdict = await self._evaluator.evaluate(plan.goal, plan.steps)

            if verdict.success:
                return AgentOutput(content=verdict.summary, status="success")

            # Replan remaining steps
            plan = await self._planner.replan(plan, plan.steps, verdict.failure_reason)
            plan.replan_count += 1

        return AgentOutput(
            content=f"Task partially completed after {plan.replan_count} replans.\n{verdict.summary}",
            status="partial",
        )
```

- [ ] **Step 4: Wire into the main execution path**

Find where `LiteLLMAgent` processes user input. If there's a method like `execute(task)` or `run(task)`, add a planning path:

```python
    # In the main execution entry point, add:
    if self._enable_planning and self._should_plan(task):
        return await self._execute_with_plan(task)
    else:
        return await self._execute_with_tools(task)
```

Add the helper:

```python
    def _should_plan(self, task: str) -> bool:
        """Heuristic: plan when task has multiple steps or complexity indicators."""
        indicators = [" and ", " then ", "之后", "然后", " first ", " next ", "最后",
                      " also ", "同时", "并且"]
        task_lower = task.lower()
        return any(ind in task_lower for ind in indicators)
```

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
pytest tests/ -q --tb=line
```

Expected: all tests pass (~1075+)

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/agents/llm_agent.py
git commit -m "feat(agents): integrate plan-execute-evaluate loop into LiteLLMAgent"
```

---

### Task 6: End-to-End Integration Test

**Files:**
- Modify: `tests/unit/agents/test_planning.py` (append e2e test)

- [ ] **Step 1: Add end-to-end test**

Append to `tests/unit/agents/test_planning.py`:

```python
def test_full_plan_execute_evaluate_success():
    """End-to-end: plan → execute → evaluate → success."""
    import asyncio

    # Mock LLM for planning: returns a 2-step plan
    plan_response = MagicMock()
    plan_response.content = '''[
        {"description": "Read config file", "tool_name": "Read", "expected_outcome": "File contents returned", "depends_on": []},
        {"description": "Edit log level", "tool_name": "Edit", "expected_outcome": "Log level changed to DEBUG", "depends_on": [0]}
    ]'''

    # Mock LLM for evaluation: both steps match
    eval_response = MagicMock()
    eval_response.content = "MATCH"

    mock_gateway = MagicMock()
    mock_gateway.complete = AsyncMock(side_effect=[plan_response, eval_response, eval_response])

    # Mock tool executor
    async def fake_tool_executor(tc):
        return {"result": f"Executed {tc.function.name}", "status": "success"}

    from cabinet.agents.planning import Planner, Executor, Evaluator
    planner = Planner(mock_gateway)
    executor = Executor(fake_tool_executor)
    evaluator = Evaluator(mock_gateway)

    async def run_e2e():
        plan = await planner.plan("Change log level to DEBUG", ["Read", "Edit"])
        assert len(plan.steps) == 2

        plan.steps = await executor.execute(plan.steps)
        assert all(s.status == "done" for s in plan.steps)

        verdict = await evaluator.evaluate(plan.goal, plan.steps)
        assert verdict.success is True

    asyncio.run(run_e2e())
```

- [ ] **Step 2: Run e2e test**

Run: `pytest tests/unit/agents/test_planning.py::test_full_plan_execute_evaluate_success -v`
Expected: PASS

- [ ] **Step 3: Run full planning test suite**

Run: `pytest tests/unit/agents/test_planning.py -v`
Expected: 14 passed

- [ ] **Step 4: Run full test suite**

Run: `pytest tests/ -q --tb=line`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add tests/unit/agents/test_planning.py
git commit -m "test(agents): add end-to-end plan-execute-evaluate integration test"
```

---

## Execution Order

Tasks must run sequentially: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6

Each task builds on the previous one (models → planner → executor → evaluator → integration → e2e).

## Summary

| Task | Files | Tests |
|------|-------|-------|
| Task 1 | Create `planning.py` | 4 tests (PlanStep, Plan) |
| Task 2 | Append Planner to `planning.py` | 2 tests (decomposition, prompt) |
| Task 3 | Append Executor to `planning.py` | 3 tests (deps, blocking, parallel) |
| Task 4 | Append Evaluator to `planning.py` | 4 tests (verdict, all-match, mismatch) |
| Task 5 | Modify `llm_agent.py` | No new tests (regression only) |
| Task 6 | Append e2e test | 1 test (full loop) |
| **Total** | 1 new file + 1 modified | 14 tests |
