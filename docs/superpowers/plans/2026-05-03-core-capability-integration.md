# 核心能力集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MCPConnector、KnowledgeBase、MemoryStore 三项核心能力统一接入 CabinetRuntime，修复 ChromaDB eval() 安全隐患。

**Architecture:** 沿用 CabinetRuntime 现有构造器注入模式，新增 4 个可选参数（mcp_connector、knowledge_base、memory_store、tool_registry），默认 None 保持向后兼容。生命周期由 CabinetRuntime 统一管理（start/stop）。

**Tech Stack:** Python 3.12+, aiosqlite, chromadb, mcp, pydantic, pytest-asyncio

---

### Task 1: ChromaDB eval() 安全修复

**Files:**
- Modify: `src/cabinet/core/knowledge/local_kb.py:1,49`
- Test: `tests/unit/core/knowledge/test_local_kb.py`

- [ ] **Step 1: 写失败测试 — 验证 metadata 包含特殊字符时 eval 会失败而 json.loads 成功**

在 `tests/unit/core/knowledge/test_local_kb.py` 末尾添加：

```python
@pytest.mark.asyncio
async def test_metadata_with_special_chars_is_safe(kb):
    docs = [
        {
            "content": "Test doc with tricky metadata",
            "source": "test",
            "metadata": {"key": "value with 'quotes' and __import__('os').name"},
        },
    ]
    await kb.index(docs)
    results = await kb.query("tricky metadata", top_k=1)
    assert len(results) >= 1
    assert isinstance(results[0].metadata, dict)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/knowledge/test_local_kb.py::test_metadata_with_special_chars_is_safe -v`
Expected: FAIL — eval() 会尝试执行 `__import__('os')` 或因引号问题报错

- [ ] **Step 3: 修复 eval() 为 json.loads()**

在 `src/cabinet/core/knowledge/local_kb.py` 头部添加 `import json`：

```python
from __future__ import annotations

import json
import uuid
```

修改第 49 行附近，将 `eval(` 替换为 `json.loads(`：

```python
metadata=json.loads(metadata.get("metadata", "{}")) if isinstance(metadata.get("metadata"), str) else metadata.get("metadata", {}),
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/core/knowledge/test_local_kb.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/knowledge/local_kb.py tests/unit/core/knowledge/test_local_kb.py
git commit -m "fix: replace eval() with json.loads() in ChromaDBKnowledgeBase for security"
```

---

### Task 2: LocalToolRegistry MCP 委托

**Files:**
- Modify: `src/cabinet/core/tools/registry.py`
- Test: `tests/unit/core/tools/test_registry.py`

- [ ] **Step 1: 写失败测试 — MCP 工具执行委托**

在 `tests/unit/core/tools/test_registry.py` 末尾添加：

```python
@pytest.mark.asyncio
async def test_set_mcp_connector():
    registry = LocalToolRegistry()
    from unittest.mock import AsyncMock
    from cabinet.core.tools.mcp_connector import MCPConnector

    connector = AsyncMock(spec=MCPConnector)
    registry.set_mcp_connector(connector)
    assert registry._mcp_connector is connector


@pytest.mark.asyncio
async def test_execute_mcp_skill_delegates_to_connector():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.mcp_connector import MCPConnector

    registry = LocalToolRegistry()
    connector = AsyncMock(spec=MCPConnector)
    connector.call_tool = AsyncMock(return_value={"content": "MCP result"})
    registry.set_mcp_connector(connector)

    skill = SkillDefinition(
        name="mcp_tool",
        description="An MCP tool",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)
    registry._mcp_skill_names.add("mcp_tool")

    output = await registry.execute("mcp_tool", {"arg": "value"})
    assert output.content == "MCP result"
    connector.call_tool.assert_called_once_with("mcp_tool", {"arg": "value"})


@pytest.mark.asyncio
async def test_execute_local_skill_does_not_delegate_to_mcp():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.mcp_connector import MCPConnector

    registry = LocalToolRegistry()
    connector = AsyncMock(spec=MCPConnector)
    connector.call_tool = AsyncMock(return_value={"content": "should not be called"})
    registry.set_mcp_connector(connector)

    skill = SkillDefinition(
        name="local_skill",
        description="A local skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)

    output = await registry.execute("local_skill", {"key": "value"})
    assert output.content == "Executed local_skill"
    connector.call_tool.assert_not_called()
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/tools/test_registry.py::test_set_mcp_connector -v`
Expected: FAIL — `LocalToolRegistry` 没有 `set_mcp_connector` 方法

- [ ] **Step 3: 实现 LocalToolRegistry MCP 委托**

修改 `src/cabinet/core/tools/registry.py`：

```python
from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from cabinet.core.tools.protocol import SkillOutput
from cabinet.models.primitives import SkillDefinition

if TYPE_CHECKING:
    from cabinet.agents.skill_executor import SkillExecutor
    from cabinet.core.tools.mcp_connector import MCPConnector


class LocalToolRegistry:
    def __init__(self):
        self._skills: dict[str, SkillDefinition] = {}
        self._skills_by_id: dict[UUID, SkillDefinition] = {}
        self._executor: SkillExecutor | None = None
        self._mcp_connector: MCPConnector | None = None
        self._mcp_skill_names: set[str] = set()

    def set_executor(self, executor: SkillExecutor) -> None:
        self._executor = executor

    def set_mcp_connector(self, connector: MCPConnector) -> None:
        self._mcp_connector = connector

    async def register(self, skill: SkillDefinition) -> None:
        self._skills[skill.name] = skill
        self._skills_by_id[skill.id] = skill

    async def execute(self, skill_name: str, inputs: dict) -> SkillOutput:
        skill = self._skills.get(skill_name)
        if skill is None:
            raise ValueError(f"Skill not found: {skill_name}")

        if skill_name in self._mcp_skill_names and self._mcp_connector is not None:
            result = await self._mcp_connector.call_tool(skill_name, inputs)
            return SkillOutput(content=result.get("content", ""), skill_id=skill.id)

        if skill.prompt_template and self._executor is not None:
            from cabinet.agents.context import SkillContext

            result = await self._executor.run(skill.id, inputs, SkillContext())
            return SkillOutput(content=result.content, skill_id=skill.id)

        return SkillOutput(content=f"Executed {skill_name}", skill_id=skill.id)

    async def list_skills(self) -> list[SkillDefinition]:
        return list(self._skills.values())

    async def get_skill(self, skill_id: UUID) -> SkillDefinition | None:
        return self._skills_by_id.get(skill_id)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/core/tools/test_registry.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/tools/registry.py tests/unit/core/tools/test_registry.py
git commit -m "feat: add MCP delegation to LocalToolRegistry"
```

---

### Task 3: CabinetRuntime 核心扩展

**Files:**
- Modify: `src/cabinet/runtime.py`
- Test: `tests/unit/test_runtime.py`

- [ ] **Step 1: 写失败测试 — 新参数默认 None 保持向后兼容**

在 `tests/unit/test_runtime.py` 末尾添加：

```python
def test_runtime_creates_with_default_tool_registry():
    from cabinet.core.tools.registry import LocalToolRegistry
    runtime = CabinetRuntime()
    assert isinstance(runtime._tool_registry, LocalToolRegistry)


def test_runtime_mcp_connector_defaults_none():
    runtime = CabinetRuntime()
    assert runtime._mcp_connector is None


def test_runtime_knowledge_base_defaults_none():
    runtime = CabinetRuntime()
    assert runtime._knowledge_base is None


def test_runtime_memory_store_defaults_none():
    runtime = CabinetRuntime()
    assert runtime._memory_store is None


def test_runtime_accepts_custom_tool_registry():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.protocol import ToolRegistry
    custom_registry = AsyncMock(spec=ToolRegistry)
    runtime = CabinetRuntime(tool_registry=custom_registry)
    assert runtime._tool_registry is custom_registry


def test_runtime_accepts_mcp_connector():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.mcp_connector import MCPConnector
    connector = AsyncMock(spec=MCPConnector)
    runtime = CabinetRuntime(mcp_connector=connector)
    assert runtime._mcp_connector is connector


def test_runtime_accepts_knowledge_base():
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase
    kb = AsyncMock(spec=KnowledgeBase)
    runtime = CabinetRuntime(knowledge_base=kb)
    assert runtime._knowledge_base is kb


def test_runtime_accepts_memory_store():
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    ms = AsyncMock(spec=MemoryStore)
    runtime = CabinetRuntime(memory_store=ms)
    assert runtime._memory_store is ms


@pytest.mark.asyncio
async def test_runtime_start_initializes_memory_store():
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    ms = AsyncMock(spec=MemoryStore)
    ms.initialize = AsyncMock()
    runtime = CabinetRuntime(memory_store=ms)
    await runtime.start()
    ms.initialize.assert_called_once()
    await runtime.stop()


@pytest.mark.asyncio
async def test_runtime_stop_closes_mcp_connector():
    from unittest.mock import AsyncMock
    from cabinet.core.tools.mcp_connector import MCPConnector
    connector = AsyncMock(spec=MCPConnector)
    connector.disconnect_all = AsyncMock()
    runtime = CabinetRuntime(mcp_connector=connector)
    await runtime.start()
    await runtime.stop()
    connector.disconnect_all.assert_called_once()


@pytest.mark.asyncio
async def test_runtime_stop_closes_memory_store():
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    ms = AsyncMock(spec=MemoryStore)
    ms.initialize = AsyncMock()
    ms.close = AsyncMock()
    runtime = CabinetRuntime(memory_store=ms)
    await runtime.start()
    await runtime.stop()
    ms.close.assert_called_once()


def test_runtime_exposes_tool_registry():
    from cabinet.core.tools.registry import LocalToolRegistry
    runtime = CabinetRuntime()
    assert isinstance(runtime.tool_registry, LocalToolRegistry)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/test_runtime.py::test_runtime_creates_with_default_tool_registry -v`
Expected: FAIL — `CabinetRuntime` 没有 `_tool_registry` 属性

- [ ] **Step 3: 实现 CabinetRuntime 扩展**

修改 `src/cabinet/runtime.py`，在导入部分添加：

```python
from cabinet.core.tools.mcp_connector import MCPConnector
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.core.knowledge.protocol import KnowledgeBase
from cabinet.core.memory.protocol import MemoryStore
from cabinet.core.tools.protocol import ToolRegistry
```

修改 `CabinetRuntime.__init__` 签名和初始化：

```python
class CabinetRuntime:
    def __init__(
        self,
        agent_factory: AgentFactory | None = None,
        gateway: object | None = None,
        db_path: str | None = None,
        mcp_connector: MCPConnector | None = None,
        knowledge_base: KnowledgeBase | None = None,
        memory_store: MemoryStore | None = None,
        tool_registry: ToolRegistry | None = None,
    ):
        self._agent_factory = agent_factory or StubAgentFactory()
        self._db_path = db_path
        self._mcp_connector = mcp_connector
        self._knowledge_base = knowledge_base
        self._memory_store = memory_store
        self._tool_registry = tool_registry or LocalToolRegistry()

        if self._mcp_connector is not None:
            self._tool_registry.set_mcp_connector(self._mcp_connector)

        if db_path:
            from cabinet.core.events.sqlite_store import SqliteEventStore
            from cabinet.core.events.sqlite_room_store import SqliteRoomEventStore

            self._event_store = SqliteEventStore(db_path)
            self._bus = AsyncIOEventBus(event_store=self._event_store)
            self._meeting_store = SqliteRoomEventStore("meeting", db_path)
            self._strategy_store = SqliteRoomEventStore("strategy", db_path)
            self._decision_store = SqliteRoomEventStore("decision", db_path)
            self._office_store = SqliteRoomEventStore("office", db_path)
            self._summary_store = SqliteRoomEventStore("summary", db_path)
            self._secretary_store = SqliteRoomEventStore("secretary", db_path)
        else:
            self._event_store = EventStore()
            self._bus = AsyncIOEventBus(event_store=self._event_store)
            self._meeting_store = RoomEventStore("meeting")
            self._strategy_store = RoomEventStore("strategy")
            self._decision_store = RoomEventStore("decision")
            self._office_store = RoomEventStore("office")
            self._summary_store = RoomEventStore("summary")
            self._secretary_store = RoomEventStore("secretary")

        self._wiring = RoomEventWiring(self._bus)

        self._evaluator = DefaultEvaluator(gateway=gateway)
        self._verification_gate = WorkflowVerificationGate(evaluator=self._evaluator)
        self._escalation_protocol = DefaultEscalationProtocol(rules=[])
        self._workflow_engine = WorkflowEngine(
            agent_factory=self._agent_factory,
            verification_gate=self._verification_gate,
        )

        self._meeting = MeetingRoomService(self._meeting_store, self._wiring, self._agent_factory)
        self._strategy = StrategyDecoderService(self._strategy_store, self._wiring, self._agent_factory)
        self._decision = DecisionRoomService(
            self._decision_store, self._wiring, self._agent_factory,
            escalation_protocol=self._escalation_protocol,
        )
        self._office = OfficeSchedulerService(
            self._office_store, self._wiring, self._agent_factory,
            verification_gate=self._verification_gate,
            workflow_engine=self._workflow_engine,
        )
        self._summary = SummaryRoomService(self._summary_store, self._wiring, self._agent_factory)
        self._secretary = SecretaryAgentService(self._secretary_store, self._wiring, self._agent_factory)

        self._meeting_handler = MeetingEventHandler()
        self._strategy_handler = StrategyEventHandler(self._strategy)
        self._decision_handler = DecisionEventHandler(self._decision)
        self._office_handler = OfficeEventHandler(self._office)
        self._summary_handler = SummaryEventHandler(self._summary)
        self._secretary_handler = SecretaryEventHandler(self._secretary)

        self._room_stores = [
            self._meeting_store,
            self._strategy_store,
            self._decision_store,
            self._office_store,
            self._summary_store,
            self._secretary_store,
        ]
```

修改 `start()` 方法：

```python
    async def start(self) -> None:
        if self._db_path:
            await self._event_store.initialize()
            for store in self._room_stores:
                await store.initialize()
            await self._meeting.restore_from_events()
            await self._strategy.restore_from_events()
            await self._decision.restore_from_events()
            await self._office.restore_from_events()
            await self._summary.restore_from_events()
            await self._secretary.restore_from_events()
        if self._memory_store is not None and hasattr(self._memory_store, "initialize"):
            await self._memory_store.initialize()
        await self._wiring.register(self._meeting_handler)
        await self._wiring.register(self._strategy_handler)
        await self._wiring.register(self._decision_handler)
        await self._wiring.register(self._office_handler)
        await self._wiring.register(self._summary_handler)
        await self._wiring.register(self._secretary_handler)
```

修改 `stop()` 方法：

```python
    async def stop(self) -> None:
        await self._wiring.unregister_all()
        if self._mcp_connector is not None:
            await self._mcp_connector.disconnect_all()
        if self._memory_store is not None and hasattr(self._memory_store, "close"):
            await self._memory_store.close()
        if self._db_path:
            for store in self._room_stores:
                await store.close()
            await self._event_store.close()
```

添加 `tool_registry` 属性：

```python
    @property
    def tool_registry(self) -> LocalToolRegistry:
        return self._tool_registry
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/test_runtime.py -v`
Expected: ALL PASS

- [ ] **Step 5: 运行全量测试确认向后兼容**

Run: `python -m pytest --tb=short -q`
Expected: 与基线一致，0 failures

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/runtime.py tests/unit/test_runtime.py
git commit -m "feat: extend CabinetRuntime with MCP/Knowledge/Memory/Tool capabilities"
```

---

### Task 4: KnowledgeBase 集成 — Secretary + WorkflowEngine

**Files:**
- Modify: `src/cabinet/models/workflows.py` (SkillNode 添加 requires_knowledge)
- Modify: `src/cabinet/rooms/secretary/service.py`
- Modify: `src/cabinet/core/workflow/engine.py`
- Test: `tests/unit/rooms/secretary/test_service.py`
- Test: `tests/unit/core/workflow/test_engine.py`

- [ ] **Step 1: 扩展 SkillNode 模型 — 添加 requires_knowledge 字段**

修改 `src/cabinet/models/workflows.py` 中的 SkillNode：

```python
class SkillNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["skill"] = "skill"
    name: str = "skill"
    skill_id: UUID
    employee_id: UUID
    inputs: dict = {}
    requires_knowledge: list[UUID] = []
```

此字段默认空列表，向后兼容。

- [ ] **Step 2: 写失败测试 — Secretary 知识库注入**

在 `tests/unit/rooms/secretary/test_service.py` 末尾添加：

```python
@pytest.mark.asyncio
async def test_greet_with_knowledge_base(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase

    kb = AsyncMock(spec=KnowledgeBase)
    kb.query = AsyncMock(return_value=[])
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), knowledge_base=kb)
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)


@pytest.mark.asyncio
async def test_process_input_queries_knowledge_base(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase
    from cabinet.core.knowledge.protocol import DocumentChunk

    kb = AsyncMock(spec=KnowledgeBase)
    kb.query = AsyncMock(return_value=[
        DocumentChunk(content="Cabinet uses event sourcing", source="docs"),
    ])
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), knowledge_base=kb)
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("how does cabinet work?", context)
    assert isinstance(response, SecretaryResponse)
    kb.query.assert_called_once()


@pytest.mark.asyncio
async def test_process_input_without_knowledge_base(publisher):
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory())
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("hello", context)
    assert isinstance(response, SecretaryResponse)
```

- [ ] **Step 3: 运行测试验证失败**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py::test_greet_with_knowledge_base -v`
Expected: FAIL — `SecretaryAgentService.__init__()` 不接受 `knowledge_base` 参数

- [ ] **Step 4: 实现 Secretary 知识库集成**

修改 `src/cabinet/rooms/secretary/service.py` 的 `__init__` 方法：

```python
class SecretaryAgentService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        knowledge_base: KnowledgeBase | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._knowledge_base = knowledge_base
        self._greetings: dict[str, str] = {}
        self._notifications: list[NotificationEvent] = []
        self._inputs: dict[str, list[str]] = {}
        self._pending_summaries: dict[str, str] = {}
        self._filtered_decisions: dict[UUID, FilterResult] = {}
```

在导入部分添加：

```python
from cabinet.core.knowledge.protocol import KnowledgeBase
```

修改 `process_input()` 方法：

```python
    async def process_input(
        self, captain_input: str, context: InteractionContext,
    ) -> SecretaryResponse:
        knowledge_context = ""
        if self._knowledge_base is not None:
            chunks = await self._knowledge_base.query(captain_input, top_k=3)
            knowledge_context = "\n".join(c.content for c in chunks)

        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        agent_context = AgentContext(model="default", temperature=0.7)
        prompt = f"Captain says: {captain_input}\n\n"
        if knowledge_context:
            prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
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
        return SecretaryResponse(message=output.content, level=SecretaryLevel.L1)
```

- [ ] **Step 5: 运行 Secretary 测试验证通过**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py -v`
Expected: ALL PASS

- [ ] **Step 6: 写失败测试 — WorkflowEngine 知识库注入**

在 `tests/unit/core/workflow/test_engine.py` 末尾添加：

```python
@pytest.mark.asyncio
async def test_engine_with_knowledge_base():
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase

    kb = AsyncMock(spec=KnowledgeBase)
    kb.query = AsyncMock(return_value=[])
    engine = WorkflowEngine(
        agent_factory=StubAgentFactory(),
        knowledge_base=kb,
    )
    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="kb_test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    results = await engine.run(workflow, {"input": "test"})
    assert str(skill_id) in results
    assert "__end__" in results


@pytest.mark.asyncio
async def test_engine_skill_node_queries_knowledge_when_required():
    from unittest.mock import AsyncMock, call
    from cabinet.core.knowledge.protocol import KnowledgeBase, DocumentChunk

    kb = AsyncMock(spec=KnowledgeBase)
    kb.query = AsyncMock(return_value=[
        DocumentChunk(content="Domain knowledge", source="docs"),
    ])
    engine = WorkflowEngine(
        agent_factory=StubAgentFactory(),
        knowledge_base=kb,
    )
    trigger_id = uuid4()
    knowledge_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="kb_required",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4(), requires_knowledge=[knowledge_id]),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    results = await engine.run(workflow, {"input": "test"})
    assert str(skill_id) in results
    kb.query.assert_called()
```

- [ ] **Step 7: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_with_knowledge_base -v`
Expected: FAIL — `WorkflowEngine.__init__()` 不接受 `knowledge_base` 参数

- [ ] **Step 8: 实现 WorkflowEngine 知识库集成**

修改 `src/cabinet/core/workflow/engine.py` 的导入和 `__init__`：

```python
from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

from cabinet.agents.context import AgentContext
from cabinet.agents.protocol import AgentFactory
from cabinet.models.workflows import (
    ConditionNode,
    EndNode,
    HumanApprovalNode,
    LoopNode,
    ParallelNode,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowNode,
)


class NodeResult:
    __slots__ = ("node_id", "output", "next_node_id")

    def __init__(self, node_id: UUID, output: dict, next_node_id: UUID | None = None):
        self.node_id = node_id
        self.output = output
        self.next_node_id = next_node_id


class WorkflowEngine:
    def __init__(
        self,
        agent_factory: AgentFactory,
        verification_gate: object | None = None,
        knowledge_base: object | None = None,
    ):
        self._agent_factory = agent_factory
        self._verification_gate = verification_gate
        self._knowledge_base = knowledge_base
```

修改 `_execute_node` 中 SkillNode 分支：

```python
        if isinstance(node, SkillNode):
            knowledge_context = ""
            if self._knowledge_base is not None and node.requires_knowledge:
                chunks = await self._knowledge_base.query(
                    str(node.skill_id), top_k=3,
                )
                knowledge_context = "\n".join(c.content for c in chunks)

            agent = await self._agent_factory.create_agent(uuid4(), "executor")
            context = AgentContext(model="default", temperature=0.3)
            prompt = f"Execute skill {node.skill_id} for employee {node.employee_id} with inputs: {node.inputs}\n\n"
            if knowledge_context:
                prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
            prompt += f"Context: {context_data}\n\nDescribe the execution result."
            output = await agent.execute(prompt, context)
            return NodeResult(node.id, {"output": output.content, "skill_id": str(node.skill_id)})
```

- [ ] **Step 9: 运行 WorkflowEngine 测试验证通过**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py -v`
Expected: ALL PASS

- [ ] **Step 10: 更新 CabinetRuntime 传递 knowledge_base**

修改 `src/cabinet/runtime.py` 中 WorkflowEngine 和 SecretaryAgentService 的创建：

```python
        self._workflow_engine = WorkflowEngine(
            agent_factory=self._agent_factory,
            verification_gate=self._verification_gate,
            knowledge_base=self._knowledge_base,
        )
```

```python
        self._secretary = SecretaryAgentService(
            self._secretary_store, self._wiring, self._agent_factory,
            knowledge_base=self._knowledge_base,
        )
```

- [ ] **Step 11: 运行全量测试确认向后兼容**

Run: `python -m pytest --tb=short -q`
Expected: 与基线一致，0 failures

- [ ] **Step 12: 提交**

```bash
git add src/cabinet/rooms/secretary/service.py src/cabinet/core/workflow/engine.py src/cabinet/runtime.py tests/unit/rooms/secretary/test_service.py tests/unit/core/workflow/test_engine.py
git commit -m "feat: integrate KnowledgeBase into Secretary and WorkflowEngine"
```

---

### Task 5: MemoryStore 集成 — Secretary

**Files:**
- Modify: `src/cabinet/rooms/secretary/service.py`
- Test: `tests/unit/rooms/secretary/test_service.py`

- [ ] **Step 1: 写失败测试 — Secretary 记忆存储注入**

在 `tests/unit/rooms/secretary/test_service.py` 末尾添加：

```python
@pytest.mark.asyncio
async def test_greet_with_memory_store(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[])
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), memory_store=ms)
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)


@pytest.mark.asyncio
async def test_greet_searches_memory_for_captain_preferences(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.models.primitives import MemoryItem, MemoryScope

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[
        MemoryItem(owner_id=uuid4(), scope=MemoryScope.LONG_TERM, content="Captain prefers concise summaries"),
    ])
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), memory_store=ms)
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)
    ms.search.assert_called_once()


@pytest.mark.asyncio
async def test_greet_without_memory_store(publisher):
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory())
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py::test_greet_with_memory_store -v`
Expected: FAIL — `SecretaryAgentService.__init__()` 不接受 `memory_store` 参数

- [ ] **Step 3: 实现 Secretary 记忆存储集成**

修改 `src/cabinet/rooms/secretary/service.py` 的 `__init__` 方法：

```python
class SecretaryAgentService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        knowledge_base: KnowledgeBase | None = None,
        memory_store: MemoryStore | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._knowledge_base = knowledge_base
        self._memory_store = memory_store
        self._greetings: dict[str, str] = {}
        self._notifications: list[NotificationEvent] = []
        self._inputs: dict[str, list[str]] = {}
        self._pending_summaries: dict[str, str] = {}
        self._filtered_decisions: dict[UUID, FilterResult] = {}
```

在导入部分添加：

```python
from cabinet.core.memory.protocol import MemoryStore
```

修改 `greet()` 方法：

```python
    async def greet(self, captain_id: str) -> Greeting:
        memory_context = ""
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope
            items = await self._memory_store.search(
                captain_id, MemoryScope.LONG_TERM, limit=3,
            )
            memory_context = "\n".join(item.content for item in items)

        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        context = AgentContext(model="default", temperature=0.7)
        prompt = f"Generate a greeting for Captain {captain_id}."
        if memory_context:
            prompt += f"\n\nCaptain's preferences and history:\n{memory_context}"
        prompt += " Include a brief summary of what you can help with today."
        output = await agent.execute(prompt, context)
        event = CaptainGreeted(captain_id=captain_id, greeting_text=output.content)
        await self._publish_and_apply(event)
        return Greeting(
            captain_id=captain_id,
            message=output.content,
            auto_processed_summary="",
            today_highlights=[],
        )
```

- [ ] **Step 4: 运行 Secretary 测试验证通过**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py -v`
Expected: ALL PASS

- [ ] **Step 5: 更新 CabinetRuntime 传递 memory_store**

修改 `src/cabinet/runtime.py` 中 SecretaryAgentService 的创建：

```python
        self._secretary = SecretaryAgentService(
            self._secretary_store, self._wiring, self._agent_factory,
            knowledge_base=self._knowledge_base,
            memory_store=self._memory_store,
        )
```

- [ ] **Step 6: 运行全量测试确认向后兼容**

Run: `python -m pytest --tb=short -q`
Expected: 与基线一致，0 failures

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/rooms/secretary/service.py src/cabinet/runtime.py tests/unit/rooms/secretary/test_service.py
git commit -m "feat: integrate MemoryStore into Secretary"
```

---

### Task 6: CLI 集成 + CabinetConfig 扩展

**Files:**
- Modify: `src/cabinet/cli/config.py`
- Modify: `src/cabinet/cli/main.py`
- Test: `tests/unit/cli/test_config.py` (新建或修改现有)

- [ ] **Step 1: 写失败测试 — CabinetConfig 支持 mcp_servers**

在 `tests/unit/cli/` 目录下找到或创建 `test_config.py`，添加：

```python
import pytest

from cabinet.cli.config import CabinetConfig
from cabinet.models.primitives import Organization
from uuid import uuid4


def test_cabinet_config_has_mcp_servers_field():
    org = Organization(name="test", captain_id="cap1")
    config = CabinetConfig(organization=org, default_project=uuid4())
    assert config.mcp_servers == []


def test_cabinet_config_with_mcp_servers():
    org = Organization(name="test", captain_id="cap1")
    servers = [{"name": "fs", "command": "npx", "args": ["-y", "server-fs"]}]
    config = CabinetConfig(
        organization=org,
        default_project=uuid4(),
        mcp_servers=servers,
    )
    assert len(config.mcp_servers) == 1
    assert config.mcp_servers[0]["name"] == "fs"


def test_cabinet_config_roundtrip_with_mcp_servers(tmp_path):
    from cabinet.cli.config import save_config, load_config

    org = Organization(name="test", captain_id="cap1")
    servers = [{"name": "fs", "command": "npx", "args": ["-y", "server-fs"]}]
    config = CabinetConfig(
        organization=org,
        default_project=uuid4(),
        mcp_servers=servers,
    )
    path = str(tmp_path / "config.json")
    save_config(config, path)
    loaded = load_config(path)
    assert len(loaded.mcp_servers) == 1
    assert loaded.mcp_servers[0]["name"] == "fs"
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/cli/test_config.py::test_cabinet_config_has_mcp_servers_field -v`
Expected: FAIL — `CabinetConfig` 没有 `mcp_servers` 属性

- [ ] **Step 3: 扩展 CabinetConfig**

修改 `src/cabinet/cli/config.py`：

```python
class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    created_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 4: 运行配置测试验证通过**

Run: `python -m pytest tests/unit/cli/test_config.py -v`
Expected: ALL PASS

- [ ] **Step 5: 修改 CLI serve/chat 命令传递核心能力**

修改 `src/cabinet/cli/main.py` 的 `_serve_async` 函数：

```python
async def _serve_async(data_dir: str) -> None:
    from cabinet.cli.config import load_config
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    kwargs = {"db_path": db_path}
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector
        kwargs["mcp_connector"] = MCPConnector()

    runtime = CabinetRuntime(**kwargs)
    await runtime.start()

    if runtime._mcp_connector is not None:
        for server_config in config.mcp_servers:
            await runtime._mcp_connector.connect_server(**server_config)
        for server_name in await runtime._mcp_connector.list_connected_servers():
            skills = await runtime._mcp_connector.discover_tools(server_name)
            for skill in skills:
                await runtime._tool_registry.register(skill)
                runtime._tool_registry._mcp_skill_names.add(skill.name)

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

修改 `_chat_async` 函数：

```python
async def _chat_async(data_dir: str) -> None:
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.cli.config import load_config
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    from cabinet.rooms.secretary.models import InteractionContext
    from cabinet.runtime import CabinetRuntime
    from rich.markdown import Markdown
    from rich.prompt import Prompt

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    gateway = LiteLLMRouterGateway(model_list=DEFAULT_MODEL_LIST)
    agent_factory = LLMAgentFactory(gateway)
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    kwargs = {"agent_factory": agent_factory, "db_path": db_path}
    if config.mcp_servers:
        from cabinet.core.tools.mcp_connector import MCPConnector
        kwargs["mcp_connector"] = MCPConnector()

    runtime = CabinetRuntime(**kwargs)
    await runtime.start()

    if runtime._mcp_connector is not None:
        for server_config in config.mcp_servers:
            await runtime._mcp_connector.connect_server(**server_config)
        for server_name in await runtime._mcp_connector.list_connected_servers():
            skills = await runtime._mcp_connector.discover_tools(server_name)
            for skill in skills:
                await runtime._tool_registry.register(skill)
                runtime._tool_registry._mcp_skill_names.add(skill.name)

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

- [ ] **Step 6: 运行全量测试确认向后兼容**

Run: `python -m pytest --tb=short -q`
Expected: 与基线一致，0 failures

- [ ] **Step 7: 运行 ruff 检查**

Run: `ruff check src/cabinet/`
Expected: 0 errors

- [ ] **Step 8: 提交**

```bash
git add src/cabinet/cli/config.py src/cabinet/cli/main.py tests/unit/cli/test_config.py
git commit -m "feat: add MCP server config and CLI integration for core capabilities"
```

---

### Task 7: 最终验证

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest --tb=short -q`
Expected: 基线 + 新增测试全部通过

- [ ] **Step 2: 运行 ruff 检查**

Run: `ruff check src/cabinet/`
Expected: 0 errors

- [ ] **Step 3: 验证协议合规**

确认所有新增参数默认 None，现有测试无需修改即可通过。确认 `SecretaryAgentService` 和 `WorkflowEngine` 的新参数遵循 Protocol 接口。
