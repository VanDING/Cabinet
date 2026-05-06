from uuid import uuid4

import pytest

from cabinet.agents.context import AgentContext
from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam
from cabinet.agents.protocol import AgentFactory, BaseAgent, BaseTeam
from cabinet.core.gateway.protocol import ModelResponse


class MockGateway:
    def __init__(self, responses: list[str] | None = None):
        self._responses = responses or ["Mock LLM response"]
        self._call_index = 0

    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse:
        response = self._responses[self._call_index % len(self._responses)]
        self._call_index += 1
        return ModelResponse(content=response, model=model)

    async def stream(self, messages, model, temperature=0.7, **kwargs):
        yield None

    def list_models(self):
        return []


def test_llm_agent_factory_satisfies_protocol():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway()
    factory = LLMAgentFactory(gateway)
    assert isinstance(factory, AgentFactory)


@pytest.mark.asyncio
async def test_create_agent_returns_lite_llm_agent():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway()
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "secretary")
    assert isinstance(agent, BaseAgent)
    assert isinstance(agent, LiteLLMAgent)
    assert agent.employee.role == "secretary"


@pytest.mark.asyncio
async def test_create_agent_uses_role_prompt():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["Hello Captain!"])
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "secretary")
    context = AgentContext()
    output = await agent.execute("greet", context)
    assert output.content == "Hello Captain!"


@pytest.mark.asyncio
async def test_create_agent_with_custom_role_prompts():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["custom response"])
    custom_prompts = {"analyst": "You are a senior financial analyst."}
    factory = LLMAgentFactory(gateway, role_prompts=custom_prompts)
    agent = await factory.create_agent(uuid4(), "analyst")
    assert agent._system_prompt == "You are a senior financial analyst."


@pytest.mark.asyncio
async def test_create_agent_unknown_role_uses_default():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["ok"])
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "unknown_role")
    assert isinstance(agent, LiteLLMAgent)
    assert agent.employee.role == "unknown_role"


@pytest.mark.asyncio
async def test_create_team_returns_llm_team():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway()
    factory = LLMAgentFactory(gateway)
    agent1 = await factory.create_agent(uuid4(), "advisor")
    agent2 = await factory.create_agent(uuid4(), "writer")
    team = await factory.create_team([agent1, agent2], "brainstorm ideas")
    assert isinstance(team, BaseTeam)
    assert isinstance(team, LLMTeam)
    assert len(team.team.employees) == 2


@pytest.mark.asyncio
async def test_default_role_prompts_contains_expected_roles():
    from cabinet.agents.llm_factory import DEFAULT_ROLE_PROMPTS

    assert "secretary" in DEFAULT_ROLE_PROMPTS
    assert "advisor" in DEFAULT_ROLE_PROMPTS
    assert "validator" in DEFAULT_ROLE_PROMPTS
    assert "strategist" in DEFAULT_ROLE_PROMPTS
    assert "executor" in DEFAULT_ROLE_PROMPTS
    assert "evaluator" in DEFAULT_ROLE_PROMPTS


@pytest.mark.asyncio
async def test_create_agent_employee_has_personality_from_prompt():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway()
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "secretary")
    assert agent.employee.personality is not None
    assert "Secretary" in agent.employee.personality or "secretary" in agent.employee.personality.lower()


@pytest.mark.asyncio
async def test_create_agent_with_memory_store():
    from unittest.mock import AsyncMock
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.core.memory.protocol import MemoryStore

    ms = AsyncMock(spec=MemoryStore)
    gateway = MockGateway(responses=["ok"])
    factory = LLMAgentFactory(gateway, memory_store=ms)
    agent = await factory.create_agent(uuid4(), "secretary")
    assert agent._memory_store is ms


@pytest.mark.asyncio
async def test_create_agent_without_memory_store():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["ok"])
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "secretary")
    assert agent._memory_store is None


@pytest.mark.asyncio
async def test_create_agent_with_employee_store():
    from unittest.mock import AsyncMock
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.models.primitives import Employee

    gateway = MockGateway(responses=["Hello from registered employee"])
    store = AsyncMock(spec=JsonEmployeeStore)
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="注册顾问", role="advisor", kind="ai",
        personality="Custom personality for registered employee",
    )
    store.get = AsyncMock(return_value=employee)
    factory = LLMAgentFactory(gateway, employee_store=store)
    agent = await factory.create_agent(employee.id, "advisor")
    assert agent.employee.name == "注册顾问"
    assert agent._system_prompt == "Custom personality for registered employee"


@pytest.mark.asyncio
async def test_create_agent_falls_back_when_not_in_store():
    from unittest.mock import AsyncMock
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["fallback"])
    store = AsyncMock(spec=JsonEmployeeStore)
    store.get = AsyncMock(return_value=None)
    factory = LLMAgentFactory(gateway, employee_store=store)
    agent = await factory.create_agent(uuid4(), "advisor")
    assert agent.employee.role == "advisor"
