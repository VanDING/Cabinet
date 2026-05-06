# 遗留差距收尾设计

日期：2026-05-03

## 背景

核心能力集成（MCP + Knowledge + Memory）已基本完成，但存在 6 个遗留差距导致部分功能实际不生效。本设计补全这些断裂点，使设计规格中描述的所有能力真正可用。

## 差距清单

| # | 差距 | 严重程度 | 根因 |
|---|------|----------|------|
| 1 | CLI 未实例化 MemoryStore | 高 | serve/chat 中 memory_store=None，Secretary 记忆代码不生效 |
| 2 | Secretary 只读不写 | 高 | process_input() 不检索记忆，无方法调用 store() |
| 3 | LiteLLMAgent 未集成 MemoryStore | 中 | Agent 只有内存 _history，无持久化记忆读写 |
| 4 | LLMAgentFactory 未传递 MemoryStore | 中 | Factory 不接受 memory_store 参数 |
| 5 | MCP 工具发现代码重复 | 中 | serve/chat 中重复代码，且直接访问 runtime 私有属性 |
| 6 | MemoryStore Protocol 缺少 initialize/close | 低 | runtime 用 hasattr 防御性检查 |

## 设计

### 1. MemoryStore Protocol 补全

在 `MemoryStore` Protocol 中增加 `initialize()` 和 `close()` 方法：

```python
@runtime_checkable
class MemoryStore(Protocol):
    async def store(self, key: str, value: MemoryItem, scope: MemoryScope) -> None: ...
    async def retrieve(self, key: str, scope: MemoryScope) -> MemoryItem | None: ...
    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]: ...
    async def delete(self, key: str, scope: MemoryScope) -> None: ...
    async def initialize(self) -> None: ...
    async def close(self) -> None: ...
```

影响：
- `SQLiteMemoryStore` — 已有 initialize()/close()，无需改动
- `VectorMemoryStore` — 需添加 initialize()/close() 空操作
- `runtime.py` — 移除 hasattr 检查，直接调用

### 2. CLI 层实例化 MemoryStore

在 `_serve_async` 和 `_chat_async` 中创建 SQLiteMemoryStore 并传入 runtime：

```python
from cabinet.core.memory.sqlite_store import SQLiteMemoryStore

memory_store = SQLiteMemoryStore(db_path=db_path)
kwargs["memory_store"] = memory_store
```

### 3. MCP 工具发现归位到 Runtime

将 MCP 工具发现逻辑封装为 `CabinetRuntime._discover_mcp_tools()` 私有方法：

```python
class CabinetRuntime:
    async def _discover_mcp_tools(self) -> None:
        if self._mcp_connector is None:
            return
        for server_name in await self._mcp_connector.list_connected_servers():
            skills = await self._mcp_connector.discover_tools(server_name)
            for skill in skills:
                await self._tool_registry.register(skill)
                self._tool_registry._mcp_skill_names.add(skill.name)
```

在 `start()` 末尾调用。CLI 层只负责创建 MCPConnector 并连接服务器，不再处理工具发现。

### 4. Secretary 补全记忆读写

#### 4a. process_input() 增加记忆检索

在生成回复前，检索 Captain 的长期记忆作为上下文：

```python
memory_context = ""
if self._memory_store is not None:
    items = await self._memory_store.search(
        context.captain_id, MemoryScope.LONG_TERM, limit=3,
    )
    memory_context = "\n".join(item.content for item in items)
```

#### 4b. process_input() 对话后存储记忆

对话完成后，将交互存储到 MemoryStore。注意 `MemoryItem` 要求 `owner_id: UUID`，而 `captain_id` 是 `str`，使用 `uuid5(NAMESPACE_DNS, captain_id)` 生成确定性 UUID：

```python
if self._memory_store is not None:
    from uuid import uuid5, NAMESPACE_DNS
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
```

#### 4c. greet() 保持只读

问候是被动响应，不需要持久化。保持只读即可。

### 5. LiteLLMAgent 集成 MemoryStore

#### 5a. 构造器增加可选 memory_store

```python
class LiteLLMAgent:
    def __init__(
        self,
        employee: Employee,
        gateway: ModelGateway,
        system_prompt: str = "",
        memory_store: MemoryStore | None = None,
    ):
```

#### 5b. execute() 增加记忆检索 + 存储

执行前检索相关记忆注入 messages，执行后将对话存入长期记忆：

```python
async def execute(self, task: str, context: AgentContext) -> AgentOutput:
    messages = [{"role": "system", "content": self._system_prompt}]

    if self._memory_store is not None:
        items = await self._memory_store.search(
            str(self._employee.id), MemoryScope.LONG_TERM, limit=5,
        )
        if items:
            memory_text = "\n".join(item.content for item in items)
            messages.append({"role": "system", "content": f"Relevant memory:\n{memory_text}"})

    messages.extend(self._history)
    messages.append({"role": "user", "content": task})
    response = await self._gateway.complete(...)
    self._history.append({"role": "user", "content": task})
    self._history.append({"role": "assistant", "content": response.content})

    if self._memory_store is not None:
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
```

### 6. LLMAgentFactory 传递 MemoryStore

```python
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
        employee = Employee(...)
        return LiteLLMAgent(employee, self._gateway, system_prompt=prompt, memory_store=self._memory_store)
```

### 7. CLI 层传递 MemoryStore 到 Factory

在 `_chat_async` 中，将 memory_store 同时传给 CabinetRuntime 和 LLMAgentFactory：

```python
memory_store = SQLiteMemoryStore(db_path=db_path)
agent_factory = LLMAgentFactory(gateway, memory_store=memory_store)
kwargs["memory_store"] = memory_store
```

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/cabinet/core/memory/protocol.py` | 增加 initialize()/close() |
| `src/cabinet/core/memory/vector_store.py` | 添加 initialize()/close() 空操作 |
| `src/cabinet/runtime.py` | 移除 hasattr 检查；添加 _discover_mcp_tools()；start() 末尾调用 |
| `src/cabinet/rooms/secretary/service.py` | process_input() 增加记忆检索 + 存储 |
| `src/cabinet/agents/llm_agent.py` | 增加 memory_store 参数；execute() 记忆读写 |
| `src/cabinet/agents/llm_factory.py` | 增加 memory_store 参数；传递给 agent |
| `src/cabinet/cli/main.py` | 实例化 MemoryStore；移除 MCP 发现重复代码 |

## 测试策略

每个改动遵循 TDD：先写失败测试，验证失败，实现，验证通过。

- Protocol 补全：验证 VectorMemoryStore 实现新方法
- CLI MemoryStore：集成测试验证 memory_store 不为 None
- MCP 发现归位：验证 runtime.start() 后 tool_registry 包含 MCP 工具
- Secretary 记忆：验证 process_input 读写记忆
- Agent 记忆：验证 execute 读写记忆
- Factory 传递：验证 create_agent 返回带 memory_store 的 agent
