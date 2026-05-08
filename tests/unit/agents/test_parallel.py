from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from cabinet.agents.parallel import ParallelExecutor, AgentTask, SynthesizedResult


def make_mock_agent(role: str, response: str):
    agent = MagicMock()
    agent.execute = AsyncMock(return_value=MagicMock(content=response, status="success"))
    return agent


def test_parallel_executes_all_agents():
    agents = [
        make_mock_agent("strategist", "We should invest in R&D"),
        make_mock_agent("executor", "I can implement the plan"),
    ]
    tasks = [
        AgentTask(agent=agents[0], task="Analyze strategy", role_label="strategist"),
        AgentTask(agent=agents[1], task="Plan execution", role_label="executor"),
    ]
    mock_gateway = MagicMock()
    mock_gateway.complete = AsyncMock(return_value=MagicMock(content="Synthesized summary"))
    executor = ParallelExecutor(mock_gateway)

    async def run():
        result = await executor.execute_parallel(tasks)
        assert len(result.individual_results) == 2
        assert result.summary == "Synthesized summary"
        assert agents[0].execute.called
        assert agents[1].execute.called

    asyncio.run(run())


def test_parallel_handles_agent_failure():
    agent_ok = make_mock_agent("ok", "Success")
    agent_fail = MagicMock()
    agent_fail.execute = AsyncMock(side_effect=RuntimeError("Boom"))
    tasks = [
        AgentTask(agent=agent_ok, task="Task 1", role_label="ok"),
        AgentTask(agent=agent_fail, task="Task 2", role_label="fail"),
    ]
    mock_gateway = MagicMock()
    mock_gateway.complete = AsyncMock(return_value=MagicMock(content="Partial summary"))
    executor = ParallelExecutor(mock_gateway)

    async def run():
        result = await executor.execute_parallel(tasks)
        assert len(result.individual_results) == 2
        statuses = [r["status"] for r in result.individual_results]
        assert "error" in statuses

    asyncio.run(run())


def test_parallel_handles_empty_tasks():
    mock_gateway = MagicMock()
    executor = ParallelExecutor(mock_gateway)
    async def run():
        result = await executor.execute_parallel([])
        assert result.individual_results == []
    asyncio.run(run())


def test_agent_task_fields():
    agent = make_mock_agent("test", "")
    task = AgentTask(agent=agent, task="Do something", role_label="tester")
    assert task.role_label == "tester"
    assert task.task == "Do something"


def test_synthesized_result_fields():
    result = SynthesizedResult(
        summary="Consensus reached",
        individual_results=[{"role": "a", "content": "yes"}],
        disagreements=["minor disagreement on timeline"],
    )
    assert result.summary == "Consensus reached"
    assert len(result.disagreements) == 1
