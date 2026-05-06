from uuid import uuid4

import pytest

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.agents.protocol import AgentFactory, BaseAgent, BaseTeam
from cabinet.agents.stub_factory import StubAgentFactory


def test_stub_agent_factory_satisfies_protocol():
    factory = StubAgentFactory()
    assert isinstance(factory, AgentFactory)


@pytest.mark.asyncio
async def test_create_agent_returns_base_agent():
    factory = StubAgentFactory()
    agent_id = uuid4()
    agent = await factory.create_agent(agent_id, "analyst")
    assert isinstance(agent, BaseAgent)
    assert agent.employee.name == "stub-agent"
    assert agent.employee.role == "analyst"


@pytest.mark.asyncio
async def test_create_agent_execute_returns_output():
    factory = StubAgentFactory()
    agent = await factory.create_agent(uuid4(), "analyst")
    context = AgentContext()
    output = await agent.execute("do something", context)
    assert isinstance(output, AgentOutput)
    assert "stub" in output.content.lower()
    assert output.employee_id == agent.employee.id


@pytest.mark.asyncio
async def test_create_agent_reflect_returns_output():
    factory = StubAgentFactory()
    agent = await factory.create_agent(uuid4(), "analyst")
    context = AgentContext()
    original = await agent.execute("do something", context)
    reflected = await agent.reflect(original)
    assert isinstance(reflected, AgentOutput)
    assert reflected.employee_id == agent.employee.id


@pytest.mark.asyncio
async def test_create_team_returns_base_team():
    factory = StubAgentFactory()
    agent1 = await factory.create_agent(uuid4(), "analyst")
    agent2 = await factory.create_agent(uuid4(), "writer")
    team = await factory.create_team([agent1, agent2], "collaborate")
    assert isinstance(team, BaseTeam)
    assert team.team.name == "stub-team"


@pytest.mark.asyncio
async def test_create_team_dispatch_returns_output():
    factory = StubAgentFactory()
    agent = await factory.create_agent(uuid4(), "analyst")
    team = await factory.create_team([agent], "collaborate")
    context = TeamContext()
    output = await team.dispatch("do something", context)
    assert isinstance(output, TeamOutput)
    assert "stub" in output.content.lower()
    assert output.team_id == team.team.id
