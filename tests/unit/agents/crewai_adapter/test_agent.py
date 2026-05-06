import sys
import uuid
from unittest.mock import MagicMock, patch

import pytest

from cabinet.agents.context import AgentContext
from cabinet.models.primitives import Employee


@pytest.fixture
def mock_crewai():
    mock_agent_cls = MagicMock()
    mock_task_cls = MagicMock()
    mock_crew_cls = MagicMock()

    mock_crew = MagicMock()
    mock_result = MagicMock()
    mock_result.raw = "Analysis complete"
    mock_crew.kickoff.return_value = mock_result
    mock_crew_cls.return_value = mock_crew

    with patch.dict(sys.modules, {
        "crewai": MagicMock(Agent=mock_agent_cls, Task=mock_task_cls, Crew=mock_crew_cls),
        "crewai.Agent": MagicMock(),
        "crewai.Task": MagicMock(),
        "crewai.Crew": MagicMock(),
    }):
        yield {
            "Agent": mock_agent_cls,
            "Task": mock_task_cls,
            "Crew": mock_crew_cls,
        }


@pytest.mark.asyncio
async def test_crewai_agent_execute(mock_crewai):
    employee = Employee(
        team_id=uuid.uuid4(),
        name="Analyst",
        role="Senior Analyst",
        kind="ai",
        personality="Analytical and precise",
    )
    from cabinet.agents.crewai_adapter.agent import CrewAIAgentAdapter
    adapter = CrewAIAgentAdapter(employee=employee, skills=[])
    ctx = AgentContext(model="default")
    output = await adapter.execute("Analyze the market", ctx)
    assert output.content == "Analysis complete"
    assert output.employee_id == employee.id


@pytest.mark.asyncio
async def test_employee_to_crewai_agent_mapping(mock_crewai):
    employee = Employee(
        team_id=uuid.uuid4(),
        name="Writer",
        role="Content Writer",
        kind="ai",
        personality="Creative and engaging",
    )
    from cabinet.agents.crewai_adapter.agent import CrewAIAgentAdapter
    adapter = CrewAIAgentAdapter(employee=employee, skills=[])
    adapter._ensure_agent()
    mock_crewai["Agent"].assert_called_once()
    call_kwargs = mock_crewai["Agent"].call_args[1]
    assert call_kwargs["role"] == "Content Writer"
    assert call_kwargs["goal"] == "Creative and engaging"
