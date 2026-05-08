import uuid
from uuid import uuid4

import pytest

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.agents.protocol import AgentFactory, BaseAgent, BaseTeam
from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.pipes.persona_registry import PersonaRegistry
from cabinet.core.pipes.registry import PipeRegistry
from cabinet.models.pipes import Persona, Pipe, ReasoningStrategy


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


@pytest.mark.asyncio
async def test_create_agent_from_pipe():
    registry = PipeRegistry()
    pipe = Pipe(
        name="测试管道",
        description="test",
        kind="atomic",
        system_prompt="你是一个测试助手",
        reasoning=ReasoningStrategy(temperature=0.2),
    )
    await registry.register(pipe)

    factory = StubAgentFactory(pipe_registry=registry)
    agent = await factory.create_agent_from_pipe(pipe.id, uuid.uuid4())
    assert agent.employee.pipe_id == pipe.id
    assert agent.employee.kind == "atomic"


@pytest.mark.asyncio
async def test_assemble_employee():
    pipe_registry = PipeRegistry()
    pipe = Pipe(
        name="分析管道",
        description="data analysis",
        kind="atomic",
        system_prompt="分析数据",
        reasoning=ReasoningStrategy(temperature=0.1),
    )
    await pipe_registry.register(pipe)

    persona_registry = PersonaRegistry()
    persona = await persona_registry.create(
        name="数据小王",
        expertise=["统计分析", "可视化"],
    )

    factory = StubAgentFactory(pipe_registry=pipe_registry, persona_registry=persona_registry)
    agent = await factory.assemble_employee(pipe.id, persona.id, uuid.uuid4())

    emp = agent.employee
    assert emp.pipe_id == pipe.id
    assert emp.persona_id == persona.id
    assert emp.name == "数据小王"
    assert emp.role == "分析管道"
    assert "统计分析" in emp.personality


@pytest.mark.asyncio
async def test_create_agent_from_pipe_nonexistent_raises():
    factory = StubAgentFactory(pipe_registry=PipeRegistry())
    with pytest.raises(ValueError, match="Pipe not found"):
        await factory.create_agent_from_pipe(uuid.uuid4(), uuid.uuid4())


@pytest.mark.asyncio
async def test_assemble_employee_nonexistent_persona_raises():
    pipe_registry = PipeRegistry()
    pipe = Pipe(name="test", description="t", kind="atomic", system_prompt="t")
    await pipe_registry.register(pipe)

    factory = StubAgentFactory(pipe_registry=pipe_registry, persona_registry=PersonaRegistry())
    with pytest.raises(ValueError, match="Persona not found"):
        await factory.assemble_employee(pipe.id, uuid.uuid4(), uuid.uuid4())
