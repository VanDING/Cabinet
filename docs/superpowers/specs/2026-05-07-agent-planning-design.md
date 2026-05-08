# Agent 自主规划与执行回路 — 设计方案

**Date**: 2026-05-07
**Status**: Approved
**Scope**: Add Plan-Execute-Evaluate loop on top of existing tool execution, enabling agents to self-decompose tasks, orchestrate tool sequences, and verify goal completion.

## 1. Context

### Current State

`LiteLLMAgent._execute_with_tools` implements a single-round tool calling loop:

```
LLM returns tool_calls → execute tools → return results → LLM decides next → repeat
```

This is reactive — the agent has no explicit planning phase and no goal-achievement verification. A task like "change log level to DEBUG and run tests to confirm nothing broke" is executed as a sequence of tool calls without checking whether the tests actually passed.

### What's Missing

1. **Planning**: No structured decomposition of complex tasks into ordered steps
2. **Dependency tracking**: No awareness that step B depends on step A's output
3. **Outcome verification**: No evaluation of whether each step achieved its expected result
4. **Recovery**: No replanning when a step fails to meet expectations

## 2. Design Overview

### Architecture

```
User task
  ↓
Planner ──→ Plan { goal, steps: [PlanStep{id, tool, expected_outcome, depends_on}] }
  ↓
Executor ──→ each step: tool call → result collection (respects dependency DAG)
  ↓           independent steps run concurrently (reuses partition_tool_calls logic)
  ↓
Evaluator ──→ expected_outcome vs actual result
  ├─ ALL MATCH → AgentOutput { status: "success" }
  └─ MISMATCH  → Planner.replan() with context from executed steps (max 3 replans)
```

### Integration

Adds a new entry point `_execute_with_plan` above the existing `_execute_with_tools` in `LiteLLMAgent`. Both paths remain available — simple tasks skip planning, complex tasks use the plan loop.

## 3. Component Design

### 3.1 PlanStep

```python
from dataclasses import dataclass, field
from uuid import uuid4

@dataclass
class PlanStep:
    description: str          # Human-readable: "Edit config.py to set DEBUG"
    tool_name: str | None     # Expected tool; None = LLM free choice
    expected_outcome: str     # Expected result for Evaluator to check
    depends_on: list[str] = field(default_factory=list)  # IDs of prerequisite steps
    id: str = field(default_factory=lambda: uuid4().hex[:8])
    result: str | None = None  # Populated during execution
    status: str = "pending"    # pending | running | done | failed | blocked
```

### 3.2 Plan

```python
@dataclass
class Plan:
    goal: str
    steps: list[PlanStep]
    max_replans: int = 3
    replan_count: int = 0
```

### 3.3 Planner

Decompose user goal into `list[PlanStep]` via LLM call:

```
System prompt: "You are a task planner. Decompose the user's goal into ordered,
actionable steps. Each step must have: description, tool_name (one of {available_tools}
or null for free choice), expected_outcome, and depends_on (list of prerequisite step indices).
Output ONLY valid JSON array of step objects."
```

```python
class Planner:
    def __init__(self, gateway, model: str = "default"):
        self._gateway = gateway
        self._model = model

    async def plan(self, goal: str, available_tools: list[str]) -> Plan:
        """Decompose goal into ordered PlanStep list."""

    async def replan(self, plan: Plan, results: list[PlanStep],
                     failure_reason: str) -> Plan:
        """Replan remaining steps given what has been executed and what failed."""
```

### 3.4 Executor

Execute steps respecting the dependency DAG:

```python
class Executor:
    def __init__(self, tool_executor):  # tool_executor = LiteLLMAgent._execute_tool_call
        self._tool_executor = tool_executor

    async def execute(self, steps: list[PlanStep]) -> list[PlanStep]:
        """
        1. Build dependency DAG from steps
        2. For each "ready" batch (no pending dependencies):
           - Independent steps: run concurrently (asyncio.gather)
           - Dependent steps: run sequentially in order
        3. Mark each step done/failed/blocked
        4. Return steps with populated results
        """
```

Dependency resolution logic:

```python
def _ready_steps(steps: list[PlanStep]) -> list[PlanStep]:
    """Return steps whose dependencies are all done."""
    done_ids = {s.id for s in steps if s.status == "done"}
    return [s for s in steps if s.status == "pending"
            and all(d in done_ids for d in s.depends_on)]

def _blocked_steps(steps: list[PlanStep]) -> list[PlanStep]:
    """Mark steps that depend on failed steps as blocked."""
    failed_ids = {s.id for s in steps if s.status == "failed"}
    for s in steps:
        if s.status == "pending" and any(d in failed_ids for d in s.depends_on):
            s.status = "blocked"
    return steps
```

### 3.5 Evaluator

Compare each step's actual result against `expected_outcome`:

```python
class Evaluator:
    def __init__(self, gateway, model: str = "default"):
        self._gateway = gateway
        self._model = model

    async def evaluate(self, goal: str, steps: list[PlanStep]) -> EvaluationVerdict:
        """
        For each done step: ask LLM "did actual result match expected_outcome?"
        
        Returns:
          - success: True if all done steps pass evaluation
          - summary: Aggregated result summary
          - failure_reason: If any step failed, description of what went wrong
        """
```

Evaluation prompt per step:

```
System: "Compare the expected outcome with the actual result. 
Answer ONLY 'MATCH' or 'MISMATCH: <reason>'."

Expected: {step.expected_outcome}
Actual: {step.result}
```

## 4. LLMAgent Integration

```python
# src/cabinet/agents/llm_agent.py

class LiteLLMAgent:
    def __init__(self, ..., enable_planning: bool = True):
        ...
        self._planner = Planner(self._gateway) if enable_planning else None
        self._executor = Executor(self._execute_tool_call) if enable_planning else None
        self._evaluator = Evaluator(self._gateway) if enable_planning else None

    async def _execute_with_plan(self, task: str) -> AgentOutput:
        """Plan-Execute-Evaluate loop with max 3 replans."""
        tools = self._tool_registry.list_tool_names()
        plan = await self._planner.plan(task, tools)

        for _ in range(plan.max_replans):
            # Mark pending steps, skip blocked ones
            for s in plan.steps:
                if s.status in ("blocked", "failed"):
                    continue
                s.status = "pending"

            plan.steps = await self._executor.execute(plan.steps)
            verdict = await self._evaluator.evaluate(plan.goal, plan.steps)

            if verdict.success:
                return AgentOutput(content=verdict.summary, status="success")

            plan = await self._planner.replan(plan, plan.steps, verdict.failure_reason)
            plan.replan_count += 1

        return AgentOutput(
            content=verdict.summary,
            status="partial",
        )
```

## 5. File Summary

| File | Operation | Content |
|------|-----------|---------|
| `src/cabinet/agents/planning.py` | **Create** | PlanStep, Plan, Planner, Executor, Evaluator |
| `src/cabinet/agents/llm_agent.py` | **Modify** | Add `_execute_with_plan`, `enable_planning` flag |
| `tests/unit/agents/test_planning.py` | **Create** | 6 tests covering planner, executor, evaluator, replan |

No breaking changes — planning is opt-in via `enable_planning=True` (default). Existing agent behavior unchanged when `enable_planning=False`.

## 6. Test Strategy

| Test | Description |
|------|------------|
| `test_plan_step_defaults` | PlanStep has correct default values (pending status, generated id, empty depends_on) |
| `test_planner_decomposes_task` | Mock LLM returns JSON → Planner.plan() returns Plan with correct goal and steps |
| `test_executor_respects_dependencies` | Steps with depends_on wait for prerequisites before executing |
| `test_executor_blocks_on_failure` | Failed prerequisite → dependent steps marked as blocked |
| `test_evaluator_detects_mismatch` | Actual result doesn't match expected → EvaluationVerdict.success = False |
| `test_replan_respects_max_attempts` | Planner.replan() called but max_replans limit enforced externally |
| `test_full_plan_execute_evaluate_success` | End-to-end mock: plan → execute → evaluate → success |
