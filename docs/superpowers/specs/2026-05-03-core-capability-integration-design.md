# 核心能力集成设计

## 背景

Cabinet 系统已完成事件溯源持久化，6 个 Room 全部实现事件驱动。但三项核心能力（MCP 工具、知识库、记忆存储）虽有实现却未接入 CabinetRuntime，导致系统无法使用外部工具、查询知识或维持跨会话记忆。

## 目标

将 MCPConnector、KnowledgeBase、MemoryStore 三项核心能力统一接入 CabinetRuntime，同时修复 ChromaDBKnowledgeBase 中的 `eval()` 安全隐患。

## 设计决策

### 方案选择：直接注入（方案 A）

沿用 CabinetRuntime 现有的构造器注入模式，新增可选参数。不引入新的抽象层（如 CapabilityRegistry 或 CabinetConfig 工厂），因为：

1. 与现有 `db_path`、`gateway`、`agent_factory` 模式完全一致
2. 改动最小，风险最低
3. 所有新参数默认 None，向后兼容

### 不处理 MeetingEventHandler

MeetingEventHandler.handle() 为空实现（pass），这是设计如此 — 其 `consumes: []` 为空列表，Meeting Room 仅产生事件不消费事件。无需修改。

## 详细设计

### 1. CabinetRuntime 扩展

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
```

**新增属性**：

| 参数 | 类型 | 默认值 | 用途 |
|------|------|--------|------|
| `mcp_connector` | `MCPConnector \| None` | None | 外部 MCP 工具服务器连接 |
| `knowledge_base` | `KnowledgeBase \| None` | None | 知识库查询 |
| `memory_store` | `MemoryStore \| None` | None | 跨会话记忆 |
| `tool_registry` | `ToolRegistry \| None` | None | 统一工具注册表 |

**tool_registry 自动创建**：如果未提供，CabinetRuntime 创建 `LocalToolRegistry` 实例。

### 2. 生命周期管理

```python
async def start(self) -> None:
    # 现有：db_path 初始化 + wiring 注册
    ...

    # 新增：MCP 工具发现
    if self._mcp_connector is not None:
        for server_config in self._mcp_servers:
            await self._mcp_connector.connect_server(**server_config)
        for server_name in await self._mcp_connector.list_connected_servers():
            skills = await self._mcp_connector.discover_tools(server_name)
            for skill in skills:
                await self._tool_registry.register(skill)

    # 新增：MemoryStore 初始化
    if self._memory_store is not None and hasattr(self._memory_store, "initialize"):
        await self._memory_store.initialize()

async def stop(self) -> None:
    # 现有：wiring 注销 + db 关闭
    ...

    # 新增：MCP 断开
    if self._mcp_connector is not None:
        await self._mcp_connector.disconnect_all()

    # 新增：MemoryStore 关闭
    if self._memory_store is not None and hasattr(self._memory_store, "close"):
        await self._memory_store.close()
```

### 3. MCP 工具集成

**架构**：

```
MCPConnector (外部工具发现)
     ↓ discover_tools()
LocalToolRegistry (本地技能 + MCP 工具注册)
     ↓
CabinetRuntime.tool_registry
     ↓
Room / Agent 通过 ToolRegistry 访问所有工具
```

**MCP 服务器配置**：通过 `cabinet.json` 的 `mcp_servers` 字段：

```json
{
  "mcp_servers": [
    {"name": "filesystem", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]}
  ]
}
```

**MCP 工具调用**：当 `tool_registry.execute(skill_name)` 执行 MCP 注册的工具时，委托给 `MCPConnector.call_tool()`。需要在 `LocalToolRegistry` 中增加对 MCP 工具的执行委托：

```python
class LocalToolRegistry:
    def __init__(self):
        self._skills: dict[str, SkillDefinition] = {}
        self._skills_by_id: dict[UUID, SkillDefinition] = {}
        self._executor: SkillExecutor | None = None
        self._mcp_connector: MCPConnector | None = None
        self._mcp_skill_names: set[str] = set()  # 追踪来自 MCP 的工具名

    def set_mcp_connector(self, connector: MCPConnector) -> None:
        self._mcp_connector = connector

    async def execute(self, skill_name: str, inputs: dict) -> SkillOutput:
        skill = self._skills.get(skill_name)
        if skill is None:
            raise ValueError(f"Skill not found: {skill_name}")

        # MCP 工具委托
        if skill_name in self._mcp_skill_names and self._mcp_connector is not None:
            result = await self._mcp_connector.call_tool(skill_name, inputs)
            return SkillOutput(content=result.get("content", ""), skill_id=skill.id)

        # 本地执行（现有逻辑）
        if skill.prompt_template and self._executor is not None:
            ...
```

注册 MCP 工具时标记来源：

```python
# CabinetRuntime.start() 中
if self._mcp_connector is not None:
    for server_config in self._mcp_servers:
        await self._mcp_connector.connect_server(**server_config)
    for server_name in await self._mcp_connector.list_connected_servers():
        skills = await self._mcp_connector.discover_tools(server_name)
        for skill in skills:
            await self._tool_registry.register(skill)
            self._tool_registry._mcp_skill_names.add(skill.name)
```

**不修改 MCPConnector 本身** — 它已经完整实现，只需通过 `set_mcp_connector()` 注入到 LocalToolRegistry。

### 4. 知识库集成

**CabinetRuntime 持有 KnowledgeBase 实例**，通过属性暴露。

**注入点**：

| Room | 用途 | 注入方式 |
|------|------|----------|
| SecretaryAgentService | 回答 Captain 问题时查询知识 | 构造器可选参数 `knowledge_base=None` |
| WorkflowEngine | 执行 `requires_knowledge` 的 SkillNode 时查询 | 构造器可选参数 `knowledge_base=None` |

**SecretaryAgentService 扩展**：

```python
class SecretaryAgentService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        knowledge_base: KnowledgeBase | None = None,  # 新增
    ):
```

在 `process_input()` 中，如果 `knowledge_base` 不为 None，先查询相关知识再交给 Agent：

```python
async def process_input(self, captain_input: str, context: InteractionContext) -> SecretaryResponse:
    knowledge_context = ""
    if self._knowledge_base is not None:
        chunks = await self._knowledge_base.query(captain_input, top_k=3)
        knowledge_context = "\n".join(c.content for c in chunks)

    agent = await self._agent_factory.create_agent(uuid4(), "secretary")
    prompt = f"Captain says: {captain_input}\n\n"
    if knowledge_context:
        prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
    prompt += "Parse this instruction and respond appropriately."
    ...
```

**WorkflowEngine 扩展**：

```python
class WorkflowEngine:
    def __init__(
        self,
        agent_factory: AgentFactory,
        verification_gate: object | None = None,
        knowledge_base: KnowledgeBase | None = None,  # 新增
    ):
```

在 `_execute_node()` 的 SkillNode 分支中，如果 `skill.requires_knowledge` 非空且 `knowledge_base` 不为 None，查询知识并注入上下文。

### 5. 记忆存储集成

**CabinetRuntime 持有 MemoryStore 实例**，通过属性暴露。

**注入点**：

| 组件 | 用途 | 注入方式 |
|------|------|----------|
| SecretaryAgentService | 记住 Captain 偏好和历史交互 | 构造器可选参数 `memory_store=None` |
| LiteLLMAgent | 维护长期对话记忆 | 构造器可选参数 `memory_store=None` |

**SecretaryAgentService 扩展**：

```python
class SecretaryAgentService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        knowledge_base: KnowledgeBase | None = None,
        memory_store: MemoryStore | None = None,  # 新增
    ):
```

在 `greet()` 中，如果 `memory_store` 不为 None，检索 Captain 的偏好记忆：

```python
async def greet(self, captain_id: str) -> Greeting:
    memory_context = ""
    if self._memory_store is not None:
        from cabinet.models.primitives import MemoryScope
        items = await self._memory_store.search(captain_id, MemoryScope.LONG_TERM, limit=3)
        memory_context = "\n".join(item.content for item in items)

    agent = await self._agent_factory.create_agent(uuid4(), "secretary")
    prompt = f"Generate a greeting for Captain {captain_id}."
    if memory_context:
        prompt += f"\n\nCaptain's preferences and history:\n{memory_context}"
    ...
```

### 6. ChromaDB eval() 安全修复

**文件**：`src/cabinet/core/knowledge/local_kb.py`

**修改**：

```python
# 修复前（不安全）：
metadata=eval(metadata.get("metadata", "{}")) if isinstance(metadata.get("metadata"), str) else metadata.get("metadata", {})

# 修复后（安全）：
metadata=json.loads(metadata.get("metadata", "{}")) if isinstance(metadata.get("metadata"), str) else metadata.get("metadata", {})
```

需要在文件头部添加 `import json`。

### 7. CLI 集成

`cabinet serve` 和 `cabinet chat` 命令需要读取 `cabinet.json` 中的 `mcp_servers` 配置，创建 MCPConnector 实例并传入 CabinetRuntime。

```python
# cli/main.py serve 命令扩展
config = load_config(config_path)
mcp_connector = None
if config.get("mcp_servers"):
    from cabinet.core.tools.mcp_connector import MCPConnector
    mcp_connector = MCPConnector()

runtime = CabinetRuntime(
    agent_factory=factory,
    gateway=gateway,
    db_path=db_path,
    mcp_connector=mcp_connector,
)
```

## 向后兼容性

| 场景 | 行为 |
|------|------|
| 不传任何新参数 | 与当前完全一致，无 MCP/知识/记忆功能 |
| 仅传 mcp_connector | MCP 工具可用，无知识/记忆 |
| 仅传 knowledge_base | 知识查询可用，无 MCP/记忆 |
| 仅传 memory_store | 记忆可用，无 MCP/知识 |
| 全部传入 | 三项能力全部可用 |

## 测试策略

1. **单元测试**：每个新注入点的 None/非 None 分支
2. **集成测试**：CabinetRuntime 完整组装 + MCP 工具发现 + 执行
3. **安全测试**：验证 json.loads 替换 eval 后行为一致
4. **向后兼容测试**：不传新参数时所有现有测试通过

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/cabinet/runtime.py` | 修改 | 新增 4 个可选参数 + 生命周期管理 |
| `src/cabinet/core/tools/registry.py` | 修改 | 新增 `set_mcp_connector()` + MCP 执行委托 |
| `src/cabinet/rooms/secretary/service.py` | 修改 | 新增 knowledge_base/memory_store 可选参数 |
| `src/cabinet/core/workflow/engine.py` | 修改 | 新增 knowledge_base 可选参数 |
| `src/cabinet/core/knowledge/local_kb.py` | 修改 | eval() → json.loads() |
| `src/cabinet/cli/main.py` | 修改 | 读取 mcp_servers 配置 |
| `tests/unit/core/tools/test_registry.py` | 修改 | MCP 委托测试 |
| `tests/unit/rooms/secretary/test_service.py` | 修改 | knowledge/memory 注入测试 |
| `tests/unit/core/workflow/test_engine.py` | 修改 | knowledge_base 注入测试 |
| `tests/unit/core/knowledge/test_local_kb.py` | 修改 | json.loads 安全测试 |
| `tests/unit/test_runtime.py` | 修改 | 新参数集成测试 |
