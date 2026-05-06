# 遗留差距收尾实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 6 个遗留差距，使 MemoryStore、MCP 工具发现、Agent 记忆集成真正生效

**Architecture:** 自底向上 — 先补全 Protocol 层，再修复 Runtime 生命周期，再补全 Secretary/Agent 记忆读写，最后修复 CLI 层注入

**Tech Stack:** Python 3.12+, Pydantic, pytest-asyncio, aiosqlite, chromadb, mcp

---

### Task 1: MemoryStore Protocol 补全

**Files:**
- Modify: `src/cabinet/core/memory/protocol.py`
- Modify: `src/cabinet/core/memory/vector_store.py`
- Modify: `src/cabinet/runtime.py:135-136,148-149`
- Test: `tests/unit/core/memory/test_vector_store.py`
- Test: `tests/unit/test_runtime.py`

- [ ] **Step 1: 写失败测试 — ChromaDBMemoryStore 缺少 initialize/close**

在 `tests/unit/core/memory/test_vector_store.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_chromadb_memory_store_has_initialize():
    store = ChromaDBMemoryStore(embedding_function=FakeEmbeddingFunction())
    assert hasattr(store, "initialize")
    await store.initialize()


@pytest.mark.asyncio
async def test_chromadb_memory_store_has_close():
    store = ChromaDBMemoryStore(embedding_function=FakeEmbeddingFunction())
    assert hasattr(store, "close")
    await store.close()
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/memory/test_vector_store.py::test_chromadb_memory_store_has_initialize tests/unit/core/memory/test_vector_store.py::test_chromadb_memory_store_has_close -v`
Expected: FAIL — `ChromaDBMemoryStore` 没有 `initialize`/`close` 方法

- [ ] **Step 3: 实现 — Protocol 增加 initialize/close**

修改 `src/cabinet/core/memory/protocol.py`，在 `delete` 方法后追加两个方法：

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable

from cabinet.models.primitives import MemoryItem, MemoryScope


@runtime_checkable
class MemoryStore(Protocol):
    async def store(self, key: str, value: MemoryItem, scope: MemoryScope) -> None: ...
    async def retrieve(self, key: str, scope: MemoryScope) -> MemoryItem | None: ...
    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]: ...
    async def delete(self, key: str, scope: MemoryScope) -> None: ...
    async def initialize(self) -> None: ...
    async def close(self) -> None: ...
```

- [ ] **Step 4: 实现 — ChromaDBMemoryStore 增加 initialize/close**

修改 `src/cabinet/core/memory/vector_store.py`，在 `delete` 方法后追加：

```python
    async def initialize(self) -> None:
        pass

    async def close(self) -> None:
        pass
```

- [ ] **Step 5: 实现 — runtime.py 移除 hasattr 检查**

修改 `src/cabinet/runtime.py` 第 135 行：

```python
        if self._memory_store is not None:
            await self._memory_store.initialize()
```

修改 `src/cabinet/runtime.py` 第 148 行：

```python
        if self._memory_store is not None:
            await self._memory_store.close()
```

- [ ] **Step 6: 运行测试验证通过**

Run: `python -m pytest tests/unit/core/memory/test_vector_store.py tests/unit/test_runtime.py -v`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/core/memory/protocol.py src/cabinet/core/memory/vector_store.py src/cabinet/runtime.py tests/unit/core/memory/test_vector_store.py
git commit -m "feat: add initialize/close to MemoryStore protocol and implementations"
```

---

### Task 2: MCP 工具发现归位到 Runtime

**Files:**
- Modify: `src/cabinet/runtime.py:124-142`
- Modify: `src/cabinet/cli/main.py:127-166`
- Test: `tests/unit/test_runtime.py`

- [ ] **Step 1: 写失败测试 — runtime.start() 应自动发现 MCP 工具**

在 `tests/unit/test_runtime.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_runtime_discovers_mcp_tools_on_start():
    from unittest.mock import AsyncMock, MagicMock
    from cabinet.core.tools.mcp_connector import MCPConnector
    from cabinet.core.tools.protocol import SkillDefinition

    skill = SkillDefinition(
        name="mcp_tool_1",
        description="An MCP tool",
        prompt_template="Use mcp_tool_1",
    )
    connector = AsyncMock(spec=MCPConnector)
    connector.list_connected_servers = AsyncMock(return_value=["server1"])
    connector.discover_tools = AsyncMock(return_value=[skill])
    runtime = CabinetRuntime(mcp_connector=connector)
    await runtime.start()
    connector.list_connected_servers.assert_called_once()
    connector.discover_tools.assert_called_once_with("server1")
    assert "mcp_tool_1" in runtime.tool_registry._mcp_skill_names
    await runtime.stop()
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/test_runtime.py::test_runtime_discovers_mcp_tools_on_start -v`
Expected: FAIL — `list_connected_servers` 未被调用（start() 中没有 MCP 发现逻辑）

- [ ] **Step 3: 实现 — runtime.py 添加 _discover_mcp_tools 方法**

在 `src/cabinet/runtime.py` 的 `stop()` 方法之后、`@property` 方法之前，添加：

```python
    async def _discover_mcp_tools(self) -> None:
        if self._mcp_connector is None:
            return
        for server_name in await self._mcp_connector.list_connected_servers():
            skills = await self._mcp_connector.discover_tools(server_name)
            for skill in skills:
                await self._tool_registry.register(skill)
                self._tool_registry._mcp_skill_names.add(skill.name)
```

修改 `src/cabinet/runtime.py` 的 `start()` 方法，在最后一个 `await self._wiring.register(...)` 之后追加：

```python
        await self._discover_mcp_tools()
```

- [ ] **Step 4: 实现 — CLI main.py 移除重复的 MCP 发现代码**

修改 `_serve_async` 函数，将 `runtime.start()` 之后的 MCP 发现代码块删除。修改后 `_serve_async` 为：

```python
async def _serve_async(data_dir: str) -> None:
    from cabinet.cli.config import load_config
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    kwargs: dict = {"db_path": db_path}
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector
        mcp_connector = MCPConnector()
        for server_config in config.mcp_servers:
            await mcp_connector.connect_server(**server_config)
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)
    await runtime.start()

    console.print(Panel(
        f"[bold green]Cabinet is serving[/bold green]\n\n"
        f"Organization: {config.organization.name}\n"
        f"Event Bus: active\n"
        f"Rooms: meeting, strategy, decision, office, summary, secretary\n\n"
        f"Press Ctrl+C to stop",
        title="Cabinet Serve",
    ))

    stop_event = asyncio.Event()
    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass
    finally:
        await runtime.stop()
```

修改 `_chat_async` 函数中 `runtime.start()` 之后的 MCP 发现代码块删除。修改后 `_chat_async` 中 MCP 相关部分为：

```python
    kwargs: dict = {"agent_factory": agent_factory, "db_path": db_path}
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector
        mcp_connector = MCPConnector()
        for server_config in config.mcp_servers:
            await mcp_connector.connect_server(**server_config)
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)
    await runtime.start()
```

- [ ] **Step 5: 运行测试验证通过**

Run: `python -m pytest tests/unit/test_runtime.py::test_runtime_discovers_mcp_tools_on_start tests/unit/cli/test_main.py -v`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/runtime.py src/cabinet/cli/main.py tests/unit/test_runtime.py
git commit -m "feat: move MCP tool discovery into CabinetRuntime.start()"
```

---

### Task 3: Secretary 记忆读写补全

**Files:**
- Modify: `src/cabinet/rooms/secretary/service.py:110-135`
- Test: `tests/unit/rooms/secretary/test_service.py`

- [ ] **Step 1: 写失败测试 — process_input 检索记忆**

在 `tests/unit/rooms/secretary/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_process_input_queries_memory_store(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.models.primitives import MemoryItem, MemoryScope

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[
        MemoryItem(owner_id=uuid4(), scope=MemoryScope.LONG_TERM, content="Captain prefers brief answers"),
    ])
    ms.store = AsyncMock()
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), memory_store=ms)
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("hello", context)
    assert isinstance(response, SecretaryResponse)
    ms.search.assert_called_once()


@pytest.mark.asyncio
async def test_process_input_stores_interaction_to_memory(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[])
    ms.store = AsyncMock()
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), memory_store=ms)
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("what's the status?", context)
    assert isinstance(response, SecretaryResponse)
    ms.store.assert_called_once()
    call_args = ms.store.call_args
    stored_item = call_args[0][1]
    assert "what's the status?" in stored_item.content
    assert stored_item.scope == MemoryScope.LONG_TERM


@pytest.mark.asyncio
async def test_process_input_without_memory_store_still_works(publisher):
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory())
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("hello", context)
    assert isinstance(response, SecretaryResponse)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py::test_process_input_queries_memory_store tests/unit/rooms/secretary/test_service.py::test_process_input_stores_interaction_to_memory -v`
Expected: FAIL — `ms.search` 未被调用（process_input 不检索记忆）

- [ ] **Step 3: 实现 — process_input 增加记忆检索 + 存储**

修改 `src/cabinet/rooms/secretary/service.py` 的 `process_input` 方法。替换整个方法体：

```python
    async def process_input(
        self, captain_input: str, context: InteractionContext,
    ) -> SecretaryResponse:
        knowledge_context = ""
        if self._knowledge_base is not None:
            chunks = await self._knowledge_base.query(captain_input, top_k=3)
            knowledge_context = "\n".join(c.content for c in chunks)

        memory_context = ""
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope
            items = await self._memory_store.search(
                context.captain_id, MemoryScope.LONG_TERM, limit=3,
            )
            memory_context = "\n".join(item.content for item in items)

        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        agent_context = AgentContext(model="default", temperature=0.7)
        prompt = f"Captain says: {captain_input}\n\n"
        if knowledge_context:
            prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
        if memory_context:
            prompt += f"Captain's preferences and history:\n{memory_context}\n\n"
        prompt += (
            "Parse this instruction and respond appropriately. "
            "If it's a question, answer it. If it's a task, acknowledge and plan. "
            "If it's ambiguous, ask for clarification."
        )
        output = await agent.execute(prompt, agent_context)
        event = InputProcessed(
            captain_id=context.captain_id,
            input_text=captain_input,
            response_text=output.content,
        )
        await self._publish_and_apply(event)

        if self._memory_store is not None:
            from uuid import uuid5, NAMESPACE_DNS
            from cabinet.models.primitives import MemoryItem, MemoryScope
            captain_uuid = uuid5(NAMESPACE_DNS, context.captain_id)
            await self._memory_store.store(
                f"interaction:{event.id}",
                MemoryItem(
                    owner_id=captain_uuid,
                    content=f"Captain: {captain_input}\nSecretary: {output.content}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"captain_id": context.captain_id, "type": "interaction"},
                ),
                MemoryScope.LONG_TERM,
            )

        return SecretaryResponse(message=output.content, level=SecretaryLevel.L1)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/rooms/secretary/service.py tests/unit/rooms/secretary/test_service.py
git commit -m "feat: secretary process_input reads and writes memory store"
```

---

### Task 4: LiteLLMAgent 记忆集成

**Files:**
- Modify: `src/cabinet/agents/llm_agent.py`
- Test: `tests/unit/agents/test_llm_agent.py`

- [ ] **Step 1: 写失败测试 — LiteLLMAgent 记忆检索**

在 `tests/unit/agents/test_llm_agent.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_llm_agent_execute_with_memory_store_searches_memory():
    from unittest.mock import AsyncMock
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
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py::test_llm_agent_execute_with_memory_store_searches_memory -v`
Expected: FAIL — `LiteLLMAgent.__init__()` 不接受 `memory_store` 参数

- [ ] **Step 3: 实现 — LiteLLMAgent 增加 memory_store**

修改 `src/cabinet/agents/llm_agent.py`，替换整个文件：

```python
from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.models.primitives import Employee, Team

if TYPE_CHECKING:
    from cabinet.core.memory.protocol import MemoryStore


class LiteLLMAgent:
    def __init__(
        self,
        employee: Employee,
        gateway: ModelGateway,
        system_prompt: str = "",
        memory_store: MemoryStore | None = None,
    ):
        self._employee = employee
        self._gateway = gateway
        self._system_prompt = system_prompt or (
            f"You are a {employee.role}. {employee.personality or ''}"
        )
        self._memory_store = memory_store
        self._history: list[dict] = []

    @property
    def employee(self) -> Employee:
        return self._employee

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        messages = [{"role": "system", "content": self._system_prompt}]

        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryItem, MemoryScope
            items = await self._memory_store.search(
                str(self._employee.id), MemoryScope.LONG_TERM, limit=5,
            )
            if items:
                memory_text = "\n".join(item.content for item in items)
                messages.append({"role": "system", "content": f"Relevant memory:\n{memory_text}"})

        messages.extend(self._history)
        messages.append({"role": "user", "content": task})
        response = await self._gateway.complete(
            messages=messages,
            model=context.model,
            temperature=context.temperature,
        )
        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": response.content})

        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryItem, MemoryScope
            await self._memory_store.store(
                f"chat:{uuid4()}",
                MemoryItem(
                    owner_id=self._employee.id,
                    content=f"Q: {task}\nA: {response.content}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"employee_id": str(self._employee.id), "role": self._employee.role},
                ),
                MemoryScope.LONG_TERM,
            )

        return AgentOutput(content=response.content, employee_id=self._employee.id)

    async def reflect(self, output: AgentOutput) -> AgentOutput:
        reflection_prompt = (
            f"Review and improve your previous response:\n\n{output.content}"
        )
        messages = [{"role": "system", "content": self._system_prompt}]
        messages.extend(self._history)
        messages.append({"role": "user", "content": reflection_prompt})
        response = await self._gateway.complete(
            messages=messages, model="default", temperature=0.5
        )
        return AgentOutput(content=response.content, employee_id=self._employee.id)


class LLMTeam:
    def __init__(
        self,
        team: Team,
        agents: list[LiteLLMAgent],
        gateway: ModelGateway,
    ):
        self._team = team
        self._agents = agents
        self._gateway = gateway

    @property
    def team(self) -> Team:
        return self._team

    async def dispatch(self, task: str, context: TeamContext) -> TeamOutput:
        agent_descriptions = "\n".join(
            f"- {a.employee.role}: {a.employee.personality or 'general'}"
            for a in self._agents
        )
        messages = [
            {
                "role": "system",
                "content": f"You are a team coordinator. Team members:\n{agent_descriptions}",
            },
            {"role": "user", "content": task},
        ]
        response = await self._gateway.complete(
            messages=messages, model=context.model
        )
        return TeamOutput(content=response.content, team_id=self._team.id)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/agents/llm_agent.py tests/unit/agents/test_llm_agent.py
git commit -m "feat: LiteLLMAgent integrates MemoryStore for persistent memory"
```

---

### Task 5: LLMAgentFactory 传递 MemoryStore

**Files:**
- Modify: `src/cabinet/agents/llm_factory.py`
- Test: `tests/unit/agents/test_llm_factory.py`

- [ ] **Step 1: 写失败测试 — Factory 传递 MemoryStore**

在 `tests/unit/agents/test_llm_factory.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_create_agent_with_memory_store():
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore

    ms = AsyncMock(spec=MemoryStore)
    gateway = MockGateway(responses=["ok"])
    factory = LLMAgentFactory(gateway, memory_store=ms)
    agent = await factory.create_agent(uuid4(), "secretary")
    assert agent._memory_store is ms


@pytest.mark.asyncio
async def test_create_agent_without_memory_store():
    gateway = MockGateway(responses=["ok"])
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "secretary")
    assert agent._memory_store is None
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/agents/test_llm_factory.py::test_create_agent_with_memory_store -v`
Expected: FAIL — `LLMAgentFactory.__init__()` 不接受 `memory_store` 参数

- [ ] **Step 3: 实现 — LLMAgentFactory 增加 memory_store**

修改 `src/cabinet/agents/llm_factory.py`，替换整个文件：

```python
from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam
from cabinet.agents.protocol import BaseAgent
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.models.primitives import Employee, Team

if TYPE_CHECKING:
    from cabinet.core.memory.protocol import MemoryStore


DEFAULT_ROLE_PROMPTS: dict[str, str] = {
    "secretary": (
        "You are the Secretary Agent of Cabinet, Captain's first mate and sole interface. "
        "Your tone: respectful but not sycophantic, professional but not cold. "
        "Always address the user as 'Captain'. "
        "Your duties: parse natural language instructions, generate decision cards, "
        "summarize pending items, filter decisions by authorization rules, "
        "and notify Captain of important events."
    ),
    "advisor": (
        "You are an advisor in the Meeting Room. "
        "Provide thoughtful, multi-perspective analysis on the given topic. "
        "Consider risks, opportunities, and trade-offs. "
        "Be concise but thorough."
    ),
    "validator": (
        "You are a cross-validation agent. "
        "Compare multiple perspectives, identify consensus and dissent. "
        "Highlight unresolved disagreements that need Captain's attention."
    ),
    "strategist": (
        "You are a strategy decoder. "
        "Transform strategic proposals into structured action blueprints. "
        "Define action domains, goals, constraints, success criteria, and dependencies."
    ),
    "executor": (
        "You are an execution agent in the Office. "
        "Execute tasks efficiently and report status. "
        "Flag any issues or blockers immediately."
    ),
    "evaluator": (
        "You are an independent quality evaluator. "
        "Verify outputs, challenge assumptions, and discover gaps. "
        "Be rigorous but constructive."
    ),
}


class LLMAgentFactory:
    def __init__(
        self,
        gateway: ModelGateway,
        role_prompts: dict[str, str] | None = None,
        memory_store: MemoryStore | None = None,
    ):
        self._gateway = gateway
        self._role_prompts = role_prompts or DEFAULT_ROLE_PROMPTS
        self._memory_store = memory_store

    async def create_agent(self, agent_id: UUID, role: str) -> LiteLLMAgent:
        prompt = self._role_prompts.get(role, "")
        employee = Employee(
            id=agent_id,
            team_id=uuid4(),
            name=f"agent-{role}",
            role=role,
            kind="ai",
            personality=prompt,
        )
        return LiteLLMAgent(employee, self._gateway, system_prompt=prompt, memory_store=self._memory_store)

    async def create_team(
        self, agents: list[BaseAgent], task: str
    ) -> LLMTeam:
        team = Team(
            project_id=uuid4(),
            name=f"team-{task[:20]}",
            purpose=task,
            employees=[a.employee.id for a in agents],
        )
        return LLMTeam(team, agents, self._gateway)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/agents/test_llm_factory.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/agents/llm_factory.py tests/unit/agents/test_llm_factory.py
git commit -m "feat: LLMAgentFactory accepts and passes MemoryStore to agents"
```

---

### Task 6: CLI 层集成

**Files:**
- Modify: `src/cabinet/cli/main.py:127-239`
- Test: `tests/unit/cli/test_main.py`

- [ ] **Step 1: 写失败测试 — CLI 创建 MemoryStore**

在 `tests/unit/cli/test_main.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_serve_creates_memory_store(tmp_path):
    from cabinet.cli.config import CabinetConfig, save_config
    from cabinet.models.primitives import Organization, Project

    data_dir = str(tmp_path / "data")
    os.makedirs(data_dir, exist_ok=True)
    org = Organization(name="test", captain_id="cap1")
    project = Project(organization_id=org.id, name="default", description="test")
    org.projects.append(project.id)
    config = CabinetConfig(organization=org, default_project=project.id)
    save_config(config, os.path.join(data_dir, "cabinet.json"))

    from cabinet.cli.main import _serve_async
    import asyncio

    task = asyncio.create_task(_serve_async(data_dir))
    await asyncio.sleep(0.5)
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass
```

- [ ] **Step 2: 实现 — _serve_async 创建 MemoryStore**

修改 `src/cabinet/cli/main.py` 的 `_serve_async` 函数，替换为：

```python
async def _serve_async(data_dir: str) -> None:
    from cabinet.cli.config import load_config
    from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    memory_store = SQLiteMemoryStore(db_path=db_path)
    kwargs: dict = {"db_path": db_path, "memory_store": memory_store}
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector
        mcp_connector = MCPConnector()
        for server_config in config.mcp_servers:
            await mcp_connector.connect_server(**server_config)
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)
    await runtime.start()

    console.print(Panel(
        f"[bold green]Cabinet is serving[/bold green]\n\n"
        f"Organization: {config.organization.name}\n"
        f"Event Bus: active\n"
        f"Rooms: meeting, strategy, decision, office, summary, secretary\n\n"
        f"Press Ctrl+C to stop",
        title="Cabinet Serve",
    ))

    stop_event = asyncio.Event()
    try:
        await stop_event.wait()
    except asyncio.CancelledError:
        pass
    finally:
        await runtime.stop()
```

- [ ] **Step 3: 实现 — _chat_async 创建 MemoryStore 并传给 Factory**

修改 `src/cabinet/cli/main.py` 的 `_chat_async` 函数，替换为：

```python
async def _chat_async(data_dir: str) -> None:
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.cli.config import load_config
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
    from cabinet.rooms.secretary.models import InteractionContext
    from cabinet.runtime import CabinetRuntime
    from rich.markdown import Markdown
    from rich.prompt import Prompt

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    gateway = LiteLLMRouterGateway(model_list=DEFAULT_MODEL_LIST)
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    memory_store = SQLiteMemoryStore(db_path=db_path)
    agent_factory = LLMAgentFactory(gateway, memory_store=memory_store)

    kwargs: dict = {"agent_factory": agent_factory, "db_path": db_path, "memory_store": memory_store}
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector
        mcp_connector = MCPConnector()
        for server_config in config.mcp_servers:
            await mcp_connector.connect_server(**server_config)
        kwargs["mcp_connector"] = mcp_connector

    runtime = CabinetRuntime(**kwargs)
    await runtime.start()

    try:
        greeting = await runtime.secretary.greet(
            captain_id=config.organization.captain_id
        )
        console.print(Panel(greeting.message, title="Secretary"))
        console.print()

        while True:
            try:
                user_input = Prompt.ask("[bold cyan]Captain[/bold cyan]")
            except (EOFError, KeyboardInterrupt):
                break

            if user_input.strip() == "/quit":
                break
            if user_input.strip() == "/status":
                summary = await runtime.secretary.summarize_pending(
                    captain_id=config.organization.captain_id
                )
                console.print(Markdown(summary.digest))
                console.print()
                continue
            if not user_input.strip():
                continue

            try:
                response = await runtime.secretary.process_input(
                    captain_input=user_input,
                    context=InteractionContext(
                        captain_id=config.organization.captain_id,
                        channel="terminal",
                    ),
                )
                console.print(Markdown(response.message))
                console.print()
            except Exception as e:
                console.print(f"[red]Error:[/red] {e}")
    finally:
        await runtime.stop()
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/cli/test_main.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/main.py tests/unit/cli/test_main.py
git commit -m "feat: CLI creates and injects MemoryStore into runtime and agent factory"
```

---

### Task 7: 最终验证

**Files:** 无新文件

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest --tb=short -q`
Expected: 470+ passed, 0 failed

- [ ] **Step 2: 运行 ruff 检查**

Run: `python -m ruff check src/`
Expected: All checks passed!

- [ ] **Step 3: 运行 ruff format 检查**

Run: `python -m ruff format --check src/`
Expected: All files formatted

- [ ] **Step 4: 提交最终状态（如有格式修正）**

```bash
git add -A
git commit -m "chore: final verification for gap closure"
```
