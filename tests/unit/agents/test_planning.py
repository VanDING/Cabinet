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
