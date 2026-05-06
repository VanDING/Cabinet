# Layer 1+2 技术债清理设计

> 2026-05-02, 基于 brainstorming 产出

## 目标

在进入 Layer 3 开发之前，全面清理 Layer 1+2 的技术债务，确保地基稳固。采用方案 A（按模块垂直清理），每个模块从协议到实现到测试一次性做透。

## 当前问题清单

| # | 问题 | 严重程度 | 所在文件 |
|:---|:---|:---|:---|
| 1 | `CrewAISkillAdapter.to_crewai_tool()` 调用不存在的 `run_sync` | **阻塞** | `agents/crewai_adapter/skill.py` |
| 2 | `LocalToolRegistry.execute` 返回占位字符串 | **高** | `core/tools/registry.py` |
| 3 | `MCPConnector` 全部为骨架代码 | **高** | `core/tools/mcp_connector.py` |
| 4 | `models/workflows.py` 未实现 | **高** | 缺失 |
| 5 | Harness 协议接口未定义 | **中** | 缺失 |
| 6 | CLI 命令全部为占位实现 | **中** | `cli/main.py` |

## 阶段 1：Bug 修复

### 1.1 CrewAISkillAdapter.run_sync

**问题**：`skill.py:26` 调用 `self._executor.run_sync()`，但 `SkillExecutor` 只定义了异步 `run()` 方法。

**修复**：
- 在 `SkillExecutor` 中添加 `run_sync()` 方法，内部使用 `asyncio.run()` 包装异步 `run()`
- `to_crewai_tool()` 中的 lambda 改为调用 `run_sync()`

### 1.2 LocalToolRegistry.execute 占位返回

**问题**：`execute()` 返回 `"Executed {skill_name}"` 字符串，不执行真实逻辑。

**修复**：
- `LocalToolRegistry` 构造函数接受可选的 `SkillExecutor` 和 `ModelGateway` 引用
- `execute()` 根据 skill 类型分派：
  - 有 `prompt_template` → 委托 `SkillExecutor.run()`
  - 无 `prompt_template` → 通过 MCP 或返回结构化占位
- 保持向后兼容：无 executor 时仍返回占位（用于测试）

## 阶段 2：MCPConnector 真实实现

### 当前状态

`_list_tools()` 返回空列表，`_call_tool()` 返回占位字典。

### 目标

通过 MCP Python SDK 的 stdio 传输层连接本地 MCP Server，实现工具发现和调用。

### 接口设计

```python
class MCPConnector:
    def __init__(self):
        self._sessions: dict[str, ClientSession] = {}
        self._tool_to_server: dict[str, str] = {}

    async def connect_server(self, name: str, command: str, args: list[str] = [], env: dict = {}) -> None

    async def disconnect_server(self, name: str) -> None

    async def disconnect_all(self) -> None

    async def discover_tools(self, server_name: str) -> list[SkillDefinition]

    async def call_tool(self, tool_name: str, arguments: dict) -> dict

    async def list_connected_servers(self) -> list[str]
```

### 实现要点

- 使用 `mcp.client.stdio.stdio_client` 建立 stdio 传输
- `connect_server` 启动 MCP Server 子进程，建立会话，初始化
- `discover_tools` 调用 MCP `list_tools`，将 `Tool.inputSchema` 映射为 `SkillDefinition.input_schema`
- `call_tool` 通过 `_tool_to_server` 映射找到对应 session，调用 `call_tool`
- 连接生命周期管理：`connect_server` / `disconnect_server` / `disconnect_all`
- 异常处理：连接失败、Server 崩溃、超时

### MCP Tool → SkillDefinition 映射

| MCP Tool 字段 | SkillDefinition 字段 |
|:---|:---|
| `name` | `name` |
| `description` | `description` |
| `inputSchema` | `input_schema` |
| — | `kind` = "atomic" |
| — | `output_schema` = {"type": "object"} |

## 阶段 3：Workflow 节点模型

### 当前状态

`models/workflows.py` 不存在。

### 目标

实现完整的 Workflow 节点模型，对齐产品文档第七章办公室模块。

### 节点类型

| 节点类型 | 模型类 | discriminator 值 | 核心字段 |
|:---|:---|:---|:---|
| 触发器 | `TriggerNode` | `trigger` | `trigger_type`, `condition` |
| 技能 | `SkillNode` | `skill` | `skill_id`, `employee_id`, `inputs` |
| 条件分支 | `ConditionNode` | `condition` | `expression`, `true_next`, `false_next` |
| 循环 | `LoopNode` | `loop` | `iterator_expr`, `body_node_ids` |
| 人在回路确认 | `HumanApprovalNode` | `human_approval` | `decision_type`, `message_template` |
| 人类员工 | `HumanNode` | `human` | `employee_id`, `input_protocol`, `output_protocol`, `timeout`, `timeout_strategy` |
| 并行/聚合 | `ParallelNode` | `parallel` | `branch_node_ids`, `aggregation_strategy` |
| 结束 | `EndNode` | `end` | `output_mapping` |

### 顶层模型

```python
class WorkflowEdge(BaseModel):
    id: UUID
    source_node_id: UUID
    target_node_id: UUID
    condition: str | None = None

class Workflow(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    project_id: UUID
    name: str
    kind: Literal["team", "composite_skill"]
    nodes: list[Annotated[WorkflowNode, Field(discriminator="kind")]]
    edges: list[WorkflowEdge]
    version: int = 1
    created_at: datetime = Field(default_factory=_now)
```

### 技术方案

使用 Pydantic v2 的判别联合（Discriminated Union）实现节点多态：

```python
WorkflowNode = Annotated[
    Union[TriggerNode, SkillNode, ConditionNode, LoopNode,
           HumanApprovalNode, HumanNode, ParallelNode, EndNode],
    Field(discriminator="kind")
]
```

## 阶段 4：Harness 协议接口

### 当前状态

无任何 Harness 相关代码。

### 目标

定义 Harness 驾驭层的三个核心协议接口和数据模型。此阶段只定义协议，不实现逻辑。

### 协议定义

```python
@runtime_checkable
class Evaluator(Protocol):
    async def evaluate(self, output: AgentOutput, criteria: list[str]) -> EvaluationResult: ...

@runtime_checkable
class VerificationGate(Protocol):
    async def check(self, node_id: UUID, context: dict) -> GateResult: ...

@runtime_checkable
class EscalationProtocol(Protocol):
    async def should_escalate(self, decision: Decision) -> EscalationVerdict: ...
    async def auto_handle(self, decision: Decision) -> Decision: ...
```

### 数据模型

```python
class EvaluationResult(BaseModel):
    passed: bool
    score: float
    issues: list[str] = []
    suggestions: list[str] = []

class GateResult(BaseModel):
    passed: bool
    reason: str | None = None
    retry_allowed: bool = True

class EscalationVerdict(BaseModel):
    escalate: bool
    reason: str
    auto_action: str | None = None
```

### 文件位置

- 协议：`src/cabinet/core/harness/protocol.py`
- 数据模型：`src/cabinet/core/harness/models.py`
- `__init__.py`：`src/cabinet/core/harness/__init__.py`

## 阶段 5：CLI 功能化

### 当前状态

所有命令为占位实现。

### 目标

4 个 CLI 命令全部接入真实逻辑。

### 配置管理

引入轻量配置文件 `data/cabinet.json`：

```python
class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    created_at: datetime
```

### 命令设计

#### `cabinet init <name>`

1. 验证 `data/cabinet.json` 不存在（防止重复初始化）
2. 创建 `data/db/`、`data/vectors/`、`data/knowledge/` 目录
3. 创建 Organization + 默认 Project
4. 写入 `data/cabinet.json`
5. 初始化 SQLite 数据库
6. 输出成功信息（Rich 格式）

#### `cabinet serve`

1. 读取 `data/cabinet.json`，验证已初始化
2. 创建 AsyncIOEventBus + EventStore
3. 创建 LiteLLMRouterGateway
4. 注册默认事件处理器
5. 启动事件循环
6. Ctrl+C 优雅关闭

#### `cabinet status`

1. 读取 `data/cabinet.json`
2. 显示：Organization 名称、Captain ID、创建时间
3. 显示：Project 列表及状态
4. 显示：数据目录状态（DB 文件大小、向量库文档数）
5. Rich 表格格式输出

#### `cabinet chat`

1. 读取配置，初始化 Gateway
2. 进入 REPL 循环：
   - 读取用户输入（Rich prompt）
   - 调用 LLM（通过 ModelGateway）
   - 输出响应（Rich Markdown 渲染）
3. 特殊命令：`/quit` 退出、`/status` 显示状态
4. 最小版：直接 LLM 对话，无秘书人格（Layer 3 实现）

### 新增文件

- `src/cabinet/cli/config.py` — CabinetConfig 模型 + 配置读写
- `src/cabinet/cli/commands/` — 各命令实现（可选，如果 main.py 过大则拆分）

## 执行顺序与依赖

```
阶段 1: Bug 修复
  ├── 1.1 SkillExecutor.run_sync
  └── 1.2 LocalToolRegistry.execute
         ↓
阶段 2: MCPConnector
         ↓
阶段 3: Workflow 节点模型
         ↓
阶段 4: Harness 协议接口（可与阶段 3 并行）
         ↓
阶段 5: CLI 功能化（依赖阶段 1-4 全部完成）
```

## 交付标准

1. 所有现有测试继续通过
2. 新增测试覆盖所有新代码
3. `ruff check src/ tests/` 零错误
4. `cabinet init TestOrg` 可创建完整项目结构
5. `cabinet serve` 可启动事件总线
6. `cabinet status` 可显示组织状态
7. `cabinet chat` 可进行 LLM 对话
8. MCPConnector 可连接至少一个 MCP Server
9. Workflow 模型支持全部 8 种节点类型
10. Harness 三个协议接口有契约测试
