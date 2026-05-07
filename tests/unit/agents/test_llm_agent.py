from __future__ import annotations

import pytest

from uuid import uuid4

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.agents.protocol import BaseAgent, BaseTeam
from cabinet.core.gateway.protocol import ModelChunk, ModelInfo, ModelResponse
from cabinet.models.primitives import Employee, Team


class MockGateway:
    def __init__(self, responses: list[str] | None = None):
        self._responses = responses or ["Mock LLM response"]
        self._call_index = 0
        self.calls: list[dict] = []

    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse:
        self.calls.append({
            "messages": messages,
            "model": model,
            "temperature": temperature,
        })
        response = self._responses[self._call_index % len(self._responses)]
        self._call_index += 1
        return ModelResponse(content=response, model=model)

    async def stream(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ):
        yield ModelChunk(content="Mock", model=model)

    def list_models(self) -> list[ModelInfo]:
        return [ModelInfo(id="mock", provider="test")]


@pytest.mark.asyncio
async def test_mock_gateway_complete():
    gateway = MockGateway(responses=["hello"])
    response = await gateway.complete(
        messages=[{"role": "user", "content": "hi"}], model="mock"
    )
    assert response.content == "hello"
    assert response.model == "mock"
    assert len(gateway.calls) == 1


@pytest.mark.asyncio
async def test_mock_gateway_cycles_responses():
    gateway = MockGateway(responses=["first", "second"])
    r1 = await gateway.complete(messages=[], model="mock")
    r2 = await gateway.complete(messages=[], model="mock")
    r3 = await gateway.complete(messages=[], model="mock")
    assert r1.content == "first"
    assert r2.content == "second"
    assert r3.content == "first"


@pytest.mark.asyncio
async def test_llm_agent_satisfies_base_agent_protocol():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["I am an advisor"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    assert isinstance(agent, BaseAgent)


@pytest.mark.asyncio
async def test_llm_agent_execute_calls_gateway():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["Analysis complete"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext(model="default", temperature=0.7)
    output = await agent.execute("Analyze this topic", context)
    assert isinstance(output, AgentOutput)
    assert output.content == "Analysis complete"
    assert output.employee_id == employee.id
    assert len(gateway.calls) == 1
    assert gateway.calls[0]["messages"][-1]["content"] == "Analyze this topic"


@pytest.mark.asyncio
async def test_llm_agent_execute_includes_system_prompt():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["ok"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway, system_prompt="You are a strategist")
    context = AgentContext()
    await agent.execute("test", context)
    assert gateway.calls[0]["messages"][0]["role"] == "system"
    assert gateway.calls[0]["messages"][0]["content"] == "You are a strategist"


@pytest.mark.asyncio
async def test_llm_agent_execute_auto_system_prompt():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["ok"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext()
    await agent.execute("test", context)
    system_msg = gateway.calls[0]["messages"][0]
    assert system_msg["role"] == "system"
    assert "advisor" in system_msg["content"]


@pytest.mark.asyncio
async def test_llm_agent_execute_maintains_history():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["response1", "response2"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext()
    await agent.execute("first question", context)
    await agent.execute("second question", context)
    second_call_messages = gateway.calls[1]["messages"]
    user_msgs = [m for m in second_call_messages if m["role"] == "user"]
    assistant_msgs = [m for m in second_call_messages if m["role"] == "assistant"]
    assert len(user_msgs) == 2
    assert len(assistant_msgs) == 1
    assert user_msgs[0]["content"] == "first question"
    assert assistant_msgs[0]["content"] == "response1"


@pytest.mark.asyncio
async def test_llm_agent_reflect():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["initial response", "improved response"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext()
    output = await agent.execute("analyze this", context)
    assert output.content == "initial response"
    reflected = await agent.reflect(output)
    assert isinstance(reflected, AgentOutput)
    assert reflected.content == "improved response"
    assert reflected.employee_id == employee.id


@pytest.mark.asyncio
async def test_llm_team_satisfies_base_team_protocol():
    from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam

    gateway = MockGateway(responses=["team response"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    team = Team(
        project_id=uuid4(), name="test-team", purpose="test", employees=[employee.id]
    )
    llm_team = LLMTeam(team, [agent], gateway)
    assert isinstance(llm_team, BaseTeam)


@pytest.mark.asyncio
async def test_llm_team_dispatch():
    from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam

    gateway = MockGateway(responses=["coordinated result"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    team = Team(
        project_id=uuid4(), name="test-team", purpose="test", employees=[employee.id]
    )
    llm_team = LLMTeam(team, [agent], gateway)
    context = TeamContext(model="default")
    output = await llm_team.dispatch("coordinate this task", context)
    assert isinstance(output, TeamOutput)
    assert output.content == "coordinated result"
    assert output.team_id == team.id


@pytest.mark.asyncio
async def test_llm_team_dispatch_includes_agent_descriptions():
    from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam

    gateway = MockGateway(responses=["ok"])
    e1 = Employee(
        id=uuid4(), team_id=uuid4(), name="a1", role="analyst", kind="ai",
        personality="data-driven"
    )
    e2 = Employee(
        id=uuid4(), team_id=uuid4(), name="a2", role="writer", kind="ai",
        personality="creative"
    )
    a1 = LiteLLMAgent(e1, gateway)
    a2 = LiteLLMAgent(e2, gateway)
    team = Team(
        project_id=uuid4(), name="test-team", purpose="test", employees=[e1.id, e2.id]
    )
    llm_team = LLMTeam(team, [a1, a2], gateway)
    context = TeamContext()
    await llm_team.dispatch("work together", context)
    system_msg = gateway.calls[0]["messages"][0]
    assert "analyst" in system_msg["content"]
    assert "writer" in system_msg["content"]


@pytest.mark.asyncio
async def test_llm_agent_execute_with_memory_store_searches_memory():
    from unittest.mock import AsyncMock
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.models.primitives import MemoryItem, MemoryScope

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[
        MemoryItem(owner_id=uuid4(), scope=MemoryScope.LONG_TERM, content="Previous discussion about pricing"),
    ])
    ms.store = AsyncMock()
    gateway = MockGateway(responses=["Based on memory, pricing is..."])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway, memory_store=ms)
    context = AgentContext()
    output = await agent.execute("What about pricing?", context)
    assert output.content == "Based on memory, pricing is..."
    ms.search.assert_called_once_with(
        str(employee.id), MemoryScope.LONG_TERM, limit=5,
    )


@pytest.mark.asyncio
async def test_llm_agent_execute_with_memory_store_stores_interaction():
    from unittest.mock import AsyncMock
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.core.memory.protocol import MemoryStore

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[])
    ms.store = AsyncMock()
    gateway = MockGateway(responses=["Analysis result"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway, memory_store=ms)
    context = AgentContext()
    output = await agent.execute("Analyze this", context)
    assert output.content == "Analysis result"
    ms.store.assert_called_once()
    call_args = ms.store.call_args
    stored_item = call_args[0][1]
    assert "Analyze this" in stored_item.content
    assert "Analysis result" in stored_item.content


@pytest.mark.asyncio
async def test_llm_agent_execute_without_memory_store():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["No memory response"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext()
    output = await agent.execute("test", context)
    assert output.content == "No memory response"


@pytest.mark.asyncio
async def test_llm_agent_memory_injected_into_messages():
    from unittest.mock import AsyncMock
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.models.primitives import MemoryItem, MemoryScope

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[
        MemoryItem(owner_id=uuid4(), scope=MemoryScope.LONG_TERM, content="Key insight from past"),
    ])
    ms.store = AsyncMock()
    gateway = MockGateway(responses=["ok"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway, memory_store=ms)
    context = AgentContext()
    await agent.execute("test", context)
    system_msgs = [m for m in gateway.calls[0]["messages"] if m["role"] == "system"]
    memory_msgs = [m for m in system_msgs if "Relevant memory" in m["content"]]
    assert len(memory_msgs) == 1
    assert "Key insight from past" in memory_msgs[0]["content"]


@pytest.mark.asyncio
async def test_execute_stream_yields_chunks():
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.agents.context import AgentContext
    from cabinet.models.primitives import Employee

    class StreamingGateway:
        async def complete(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelResponse
            return ModelResponse(content="full response", model=model)

        async def stream(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelChunk
            yield ModelChunk(content="Hello ", model=model)
            yield ModelChunk(content="Captain", model=model)

        def list_models(self):
            return []

    gateway = StreamingGateway()
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext(model="default", temperature=0.7)

    chunks = []
    async for chunk in agent.execute_stream("test task", context):
        chunks.append(chunk)

    assert chunks == ["Hello ", "Captain"]
    assert len(agent._history) == 2
    assert agent._history[-1]["content"] == "Hello Captain"


@pytest.mark.asyncio
async def test_execute_stream_persists_to_memory():
    from unittest.mock import AsyncMock, MagicMock

    from cabinet.agents.context import AgentContext
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.models.primitives import Employee, MemoryScope

    gateway = AsyncMock()
    chunk1 = MagicMock()
    chunk1.content = "Hello"
    chunk2 = MagicMock()
    chunk2.content = " Captain"

    async def fake_stream(**kwargs):
        for chunk in [chunk1, chunk2]:
            yield chunk

    gateway.stream = fake_stream

    memory_store = AsyncMock()
    memory_store.store = AsyncMock()

    employee = Employee(id=uuid4(), team_id=uuid4(), name="TestAgent", role="advisor", kind="ai")
    agent = LiteLLMAgent(employee, gateway, memory_store=memory_store)

    context = AgentContext(model="default", temperature=0.7)
    chunks = []
    async for chunk in agent.execute_stream("test task", context):
        chunks.append(chunk)

    assert chunks == ["Hello", " Captain"]
    memory_store.store.assert_called_once()
    call_args = memory_store.store.call_args[0]
    item = call_args[1]
    assert "test task" in item.content
    assert "Hello Captain" in item.content
    assert call_args[2] == MemoryScope.LONG_TERM


@pytest.mark.asyncio
async def test_history_truncation_token_based():
    from cabinet.agents.llm_agent import LiteLLMAgent
    from unittest.mock import AsyncMock, MagicMock

    gateway = AsyncMock()
    response = MagicMock()
    response.content = "response"
    response.usage = None
    gateway.acompletion = AsyncMock(return_value=response)

    from cabinet.models.primitives import Employee
    from uuid import uuid4

    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="Test", role="test", kind="ai"
    )
    agent = LiteLLMAgent(employee=employee, gateway=gateway, max_history=3, max_context_tokens=5)

    for i in range(10):
        agent._history.append({"role": "user", "content": f"msg{i}"})
        agent._history.append({"role": "assistant", "content": f"resp{i}"})

    agent._trim_history()
    assert len(agent._history) < 20


@pytest.mark.asyncio
async def test_llm_agent_with_tools():
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.agents.tools import ToolDefinition
    from unittest.mock import MagicMock

    class ToolCallGateway:
        def __init__(self):
            self.call_count = 0

        async def complete(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelResponse
            self.call_count += 1
            if self.call_count == 1:
                tc = MagicMock(id="tc_1")
                tc.function.name = "search"
                tc.function.arguments = '{"query": "test"}'
                return ModelResponse(content="", model=model, tool_calls=[tc])
            return ModelResponse(content="Search result: found 3 items", model=model)

        async def stream(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelChunk
            yield ModelChunk(content="result", model=model)

        def list_models(self):
            return []

    gateway = ToolCallGateway()
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    tools = [ToolDefinition(
        name="search", description="Search knowledge base",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
    )]
    agent = LiteLLMAgent(employee, gateway, tools=tools)
    output = await agent.execute("Search for test", AgentContext())
    assert output.content == "Search result: found 3 items"
    assert gateway.call_count == 2


@pytest.mark.asyncio
async def test_llm_agent_execute_structured():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=['{"analysis": "positive", "confidence": 0.9}'])
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    agent = LiteLLMAgent(employee, gateway)
    output = await agent.execute_structured(
        "Analyze sentiment", AgentContext(),
        output_schema={"type": "object", "properties": {"analysis": {"type": "string"}}},
    )
    assert output.structured_data is not None
    assert output.structured_data.get("analysis") == "positive"


@pytest.mark.asyncio
async def test_llm_agent_has_circuit_breakers():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway()
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    agent = LiteLLMAgent(employee, gateway)
    assert hasattr(agent, "_tool_breaker")
    assert hasattr(agent, "_api_breaker")


@pytest.mark.asyncio
async def test_llm_agent_circuit_breaker_handles_tool_errors():
    """Tool result error when circuit breaker catches failures."""
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.agents.tools import ToolDefinition
    from unittest.mock import MagicMock

    class ToolCallGateway:
        def __init__(self):
            self.call_count = 0

        async def complete(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelResponse
            self.call_count += 1
            if self.call_count <= 2:
                tc = MagicMock(id=f"tc_{self.call_count}")
                tc.function.name = "failing_tool"
                tc.function.arguments = '{}'
                return ModelResponse(content="", model=model, tool_calls=[tc])
            return ModelResponse(content="Task complete despite tool errors", model=model)

        async def stream(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelChunk
            yield ModelChunk(content="result", model=model)

        def list_models(self):
            return []

    class FailingExecutor:
        def execute_tool(self, name, args):
            raise RuntimeError("tool execution failed")

    from cabinet.agents.tools import ToolRegistryAdapter
    tool_reg = ToolRegistryAdapter(FailingExecutor())

    gateway = ToolCallGateway()
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    tools = [ToolDefinition(
        name="failing_tool", description="Always fails",
        input_schema={"type": "object", "properties": {}},
    )]
    agent = LiteLLMAgent(employee, gateway, tools=tools, tool_registry=tool_reg)
    agent._tool_breaker.max_failures = 1

    output = await agent.execute("test", AgentContext())
    assert output.content == "Task complete despite tool errors"
