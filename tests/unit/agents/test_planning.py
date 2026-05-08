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
