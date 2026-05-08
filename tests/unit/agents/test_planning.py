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


from unittest.mock import AsyncMock, MagicMock
from cabinet.agents.planning import Planner
import asyncio


def test_planner_decomposes_simple_task():
    """Planner should decompose a task into PlanStep list via LLM."""
    mock_gateway = MagicMock()
    mock_response = MagicMock()
    mock_response.content = '''[
        {"description": "Read config.py", "tool_name": "Read", "expected_outcome": "File contents shown", "depends_on": []},
        {"description": "Edit log level to DEBUG", "tool_name": "Edit", "expected_outcome": "Log level changed", "depends_on": [0]},
        {"description": "Run tests", "tool_name": "Bash", "expected_outcome": "All tests pass", "depends_on": [1]}
    ]'''
    mock_gateway.complete = AsyncMock(return_value=mock_response)

    planner = Planner(mock_gateway)

    async def run():
        plan = await planner.plan("Change log level to DEBUG and verify tests pass", ["Read", "Edit", "Bash"])
        assert plan.goal == "Change log level to DEBUG and verify tests pass"
        assert len(plan.steps) == 3
        assert plan.steps[0].tool_name == "Read"
        assert plan.steps[1].depends_on == ["_s0_"]
        assert plan.steps[2].depends_on == ["_s1_"]

    asyncio.run(run())


def test_planner_includes_available_tools_in_prompt():
    """Planner prompt includes available tool names."""
    mock_gateway = MagicMock()
    mock_response = MagicMock()
    mock_response.content = '[]'
    mock_gateway.complete = AsyncMock(return_value=mock_response)

    planner = Planner(mock_gateway)

    async def run():
        await planner.plan("Do X", ["Read", "Bash", "Glob"])

    asyncio.run(run())

    call_args = mock_gateway.complete.call_args
    prompt_text = str(call_args)
    assert "Read" in prompt_text
    assert "Bash" in prompt_text
    assert "Glob" in prompt_text


from cabinet.agents.planning import Executor


def make_step(desc: str, expected: str, tool: str = "Read",
              depends_on: list[str] | None = None) -> PlanStep:
    return PlanStep(description=desc, expected_outcome=expected,
                    tool_name=tool, depends_on=depends_on or [])


def test_executor_respects_dependencies():
    """Steps with dependencies wait for prerequisites before executing."""
    s1 = make_step("Step 1", "Done")
    s2 = make_step("Step 2", "Done", depends_on=[s1.id])
    s3 = make_step("Step 3", "Done", depends_on=[s2.id])

    async def fake_execute(tc):
        return {"result": f"Ran {tc.function.name}", "status": "success"}

    executor = Executor(fake_execute)

    async def run():
        steps = await executor.execute([s1, s2, s3])
        assert all(s.status == "done" for s in steps)

    asyncio.run(run())


def test_executor_blocks_on_failure():
    """When a step fails, steps depending on it are marked blocked."""
    s1 = make_step("Failing step", "Done")
    s2 = make_step("Dependent step", "Done", depends_on=[s1.id])

    async def fake_failing_execute(tc):
        raise RuntimeError("Boom")

    executor = Executor(fake_failing_execute)

    async def run():
        steps = await executor.execute([s1, s2])
        assert s1.status == "failed"
        assert s2.status == "blocked"

    asyncio.run(run())


def test_executor_handles_empty():
    """Empty step list returns empty."""
    async def fake_execute(tc):
        return {"result": "ok", "status": "success"}

    executor = Executor(fake_execute)

    async def run():
        steps = await executor.execute([])
        assert steps == []

    asyncio.run(run())
