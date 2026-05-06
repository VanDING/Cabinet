# 多智能体编排设计

> 日期: 2026-05-05
> 状态: Draft
> 范围: L1 通信基础 → L2 工具调用 → L3 生命周期管理 → L4 集成打通

## 1. 背景与问题

### 1.1 当前架构

Cabinet 采用「Room 编排 + 临时 Agent + 事件驱动」模式:

- **Room 是编排者**: 每个 Room 封装一个业务领域，内部按需创建临时 Agent
- **Agent 是无状态工具**: 每次操作创建新实例，执行完即丢弃
- **事件是通信通道**: Room 之间通过 EventBus 异步通信，Agent 之间无直接交互
- **CrewAI 是可选后端**: 适配器存在但集成浅，未利用 CrewAI 的核心编排能力

### 1.2 关键缺口

| 缺口 | 说明 |
|------|------|
| Agent 间直接通信 | 无 Agent-to-Agent 消息传递机制 |
| 任务交接 (Handoff) | Agent 无法将任务交接给另一个 Agent |
| 共享工作记忆 | 每个 Agent 独立记忆，无团队共享上下文 |
| 多轮 Agent 对话 | 无法编排 A→B→A 的多轮交互 |
| Agent 工具调用 | LiteLLMAgent 无 function calling / tool use |
| 结构化输出 | AgentOutput 只有 content: str |
| Agent 能力发现 | 无法查询其他 Agent 的技能/角色 |
| Agent 生命周期管理 | 无池化、无状态追踪、无复用 |
| 动态团队组建 | Team 是静态创建的，无根据任务动态组建 |
| 协商/辩论循环 | Meeting Room 无多轮对抗性讨论 |
| Agent 级别错误恢复 | 无重试、降级、替代 Agent 策略 |
| WorkflowEngine 断链 | _execute_skill() 让 LLM "描述"结果而非真正执行 |
| Decision 委派空壳 | delegate() 只改状态，无实际交接逻辑 |
| CrewAI 适配器骨架 | tools=[] 硬编码、单 Task、memory=False |

## 2. 分层设计总览

```
L4 集成打通层  ← CrewAI 完善 + WorkflowEngine 真正集成 + Decision 委派 + Runtime 组装 + CLI/API
L3 生命周期层  ← AgentPool + TeamComposer + DebateProtocol + AgentRecovery
L2 工具调用层  ← Function Calling + ToolDefinition + StructuredOutput + CapabilityRegistry
L1 通信基础层  ← AgentMailbox + HandoffManager + SharedWorkspace + DialogueOrchestrator + AgentOutput 增强
```

## 3. L1 通信基础层

### 3.1 Agent 间消息传递 — AgentMailbox

**文件**: `src/cabinet/agents/mailbox.py`

每个 Agent 绑定一个 `AgentMailbox`，通过 `MailboxRouter` 路由消息。

```python
MsgType = Literal["request", "response", "notify", "handoff", "broadcast"]

class AgentMessage(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    sender_id: UUID
    recipient_id: UUID
    msg_type: MsgType
    content: str
    metadata: dict = {}
    reply_to: UUID | None = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class AgentMailbox:
    def __init__(self, agent_id: UUID):
        self._agent_id = agent_id
        self._queue: asyncio.Queue[AgentMessage] = asyncio.Queue()
        self._subscribers: dict[str, list[Callable]] = {}

    async def send(self, recipient_id: UUID, msg_type: str, content: str, **metadata) -> UUID: ...
    async def receive(self, timeout: float = 30.0) -> AgentMessage | None: ...
    async def broadcast(self, msg_type: str, content: str, agent_ids: list[UUID]) -> None: ...
    def on_message(self, msg_type: str, handler: Callable) -> None: ...

class MailboxRouter:
    def __init__(self):
        self._mailboxes: dict[UUID, AgentMailbox] = {}

    def register(self, agent_id: UUID, mailbox: AgentMailbox) -> None: ...
    def unregister(self, agent_id: UUID) -> None: ...
    async def route(self, message: AgentMessage) -> None: ...
    async def send_request(self, sender_id: UUID, recipient_id: UUID, content: str, timeout: float = 30.0) -> AgentMessage: ...
```

**消息类型**:

| 类型 | 说明 | 是否等待回复 |
|------|------|-------------|
| `request` | 请求另一个 Agent 执行操作 | 是 |
| `response` | 回复请求 | 否 |
| `notify` | 通知另一个 Agent | 否 |
| `handoff` | 任务交接 | 是 |
| `broadcast` | 广播给多个 Agent | 否 |

**设计要点**:
- `MailboxRouter` 维护 `agent_id -> mailbox` 映射，支持跨 Agent 消息投递
- `send_request` 支持超时等待回复，避免死锁
- `on_message` 支持按消息类型注册处理器

### 3.2 任务交接 — HandoffManager

**文件**: `src/cabinet/agents/handoff.py`

```python
HandoffReason = Literal["expertise", "capacity", "escalation", "delegation"]
HandoffPriority = Literal["low", "normal", "high", "urgent"]

class HandoffRequest(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    from_agent_id: UUID
    to_agent_id: UUID
    task_description: str
    context_snapshot: dict
    reason: HandoffReason
    priority: HandoffPriority = "normal"
    deadline: str | None = None

class HandoffResponse(BaseModel):
    request_id: UUID
    accepted: bool
    message: str = ""
    estimated_completion: str | None = None

class HandoffManager:
    def __init__(self, mailbox_router: MailboxRouter):
        self._router = mailbox_router
        self._pending: dict[UUID, HandoffRequest] = {}
        self._handlers: dict[UUID, Callable] = {}

    async def request_handoff(self, request: HandoffRequest) -> HandoffResponse: ...
    async def accept_handoff(self, request_id: UUID, agent_id: UUID) -> None: ...
    async def reject_handoff(self, request_id: UUID, reason: str) -> None: ...
    async def get_pending_handoffs(self, agent_id: UUID) -> list[HandoffRequest]: ...
```

**交接原因类型**:

| 原因 | 说明 |
|------|------|
| `expertise` | 当前 Agent 不具备所需专业知识 |
| `capacity` | 当前 Agent 负载过高 |
| `escalation` | 需要更高级别权限处理 |
| `delegation` | 主动委派给更合适的 Agent |

### 3.3 共享工作记忆 — SharedWorkspace

**文件**: `src/cabinet/agents/workspace.py`

```python
class SharedWorkspace:
    def __init__(self, team_id: UUID, memory_store: MemoryStore):
        self._team_id = team_id
        self._memory_store = memory_store
        self._scratch: dict[str, Any] = {}
        self._lock = asyncio.Lock()

    async def set(self, key: str, value: Any, scope: str = "team") -> None: ...
    async def get(self, key: str, default: Any = None) -> Any: ...
    async def append(self, key: str, value: Any) -> None: ...
    async def get_history(self, key: str, limit: int = 10) -> list[Any]: ...
    async def snapshot(self) -> dict: ...
    async def clear_scratch(self) -> None: ...
```

**设计要点**:
- 绑定到 Team，不是全局共享
- `scope` 区分 `team`（团队级持久化）和 `task`（任务级临时）
- `_scratch` 是内存中的临时草稿区，不持久化
- `asyncio.Lock` 保证并发安全

### 3.4 多轮对话编排 — DialogueOrchestrator

**文件**: `src/cabinet/agents/dialogue.py`

```python
class DialogueTurn(BaseModel):
    agent_id: UUID
    content: str
    turn_number: int
    metadata: dict = {}

class DialogueConfig(BaseModel):
    participants: list[UUID]
    mode: str = "round_robin"  # round_robin, moderator, free_form
    max_rounds: int = 5
    convergence_check: str | None = None
    moderator_id: UUID | None = None

class DialogueResult(BaseModel):
    topic: str
    turns: list[DialogueTurn]
    total_rounds: int
    converged: bool
    summary: str | None = None

class DialogueOrchestrator:
    def __init__(self, agent_pool: AgentPool, mailbox_router: MailboxRouter, agent_factory: AgentFactory): ...

    async def start_dialogue(
        self, config: DialogueConfig, topic: str, context: dict
    ) -> DialogueResult: ...

    async def _run_round_robin(self, config: DialogueConfig, topic: str, context: dict) -> list[DialogueTurn]: ...
    async def _run_moderated(self, config: DialogueConfig, topic: str, context: dict) -> list[DialogueTurn]: ...
    def _check_convergence(self, turns: list[DialogueTurn], expr: str) -> bool: ...
```

**对话模式**:

| 模式 | 说明 |
|------|------|
| `round_robin` | 参与者按顺序轮流发言 |
| `moderator` | 主持人决定谁发言、何时结束 |
| `free_form` | 参与者自由发言，通过 mailbox 交互 |

### 3.5 Agent 输出模型增强

**文件**: 修改 `src/cabinet/agents/context.py`

```python
class AgentOutput(BaseModel):
    content: str
    employee_id: UUID
    status: str = "completed"  # completed, partial, failed, needs_handoff
    structured_data: dict | None = None
    artifacts: list[dict] = []
    token_usage: dict | None = None  # {prompt_tokens, completion_tokens, total_tokens}
    duration_ms: float | None = None
    handoff_request: HandoffRequest | None = None
```

**状态类型**:

| 状态 | 说明 |
|------|------|
| `completed` | 任务完成 |
| `partial` | 部分完成（如达到最大工具调用轮次） |
| `failed` | 执行失败 |
| `needs_handoff` | 需要交接给其他 Agent |

## 4. L2 工具调用 + 结构化输出层

### 4.1 Agent Function Calling

**文件**: 修改 `src/cabinet/agents/llm_agent.py`

为 `LiteLLMAgent` 添加 LiteLLM 原生 function calling 支持:

```python
class LiteLLMAgent:
    def __init__(
        self,
        employee: Employee,
        gateway: ModelGateway,
        system_prompt: str = "",
        memory_store: MemoryStore | None = None,
        max_history: int = 10,
        tools: list[ToolDefinition] | None = None,
        tool_registry: LocalToolRegistry | None = None,
    ): ...

    def _build_tool_schemas(self) -> list[dict]:
        schemas = []
        for tool in self._tools:
            schemas.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            })
        return schemas

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        messages = self._build_messages(task, context)
        for _ in range(10):
            kwargs = {"messages": messages, **context.model_dump()}
            if self._tool_schemas:
                kwargs["tools"] = self._tool_schemas
                kwargs["tool_choice"] = "auto"
            response = await self._gateway.complete(**kwargs)
            if not response.tool_calls:
                return AgentOutput(content=response.content, employee_id=self._employee.id, token_usage=response.usage)
            messages.append(response.to_message())
            for tool_call in response.tool_calls:
                result = await self._execute_tool_call(tool_call)
                messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": json.dumps(result)})
        return AgentOutput(content="Max tool calls reached", employee_id=self._employee.id, status="partial")

    async def _execute_tool_call(self, tool_call) -> dict: ...
```

**工具调用循环**:
1. Agent 收到任务，构建 messages
2. 如果有 tools，传入 `tools` 和 `tool_choice="auto"`
3. LLM 返回 `tool_calls` → 执行工具 → 结果回注 messages
4. LLM 继续推理，可能再次调用工具或返回最终结果
5. 最多 10 轮，防止无限循环

### 4.2 ToolDefinition 统一模型

**文件**: `src/cabinet/agents/tools.py`

```python
class ToolDefinition(BaseModel):
    name: str
    description: str
    input_schema: dict
    output_schema: dict | None = None
    handler: str | None = None  # skill_id 或 mcp_tool 名称
    source: str = "skill"  # "skill", "mcp", "builtin"

class ToolRegistryAdapter:
    def __init__(self, tool_registry: LocalToolRegistry): ...

    def get_tool_definitions(self, skill_ids: list[UUID] | None = None) -> list[ToolDefinition]: ...
    async def execute_tool(self, name: str, arguments: dict) -> Any: ...
```

**设计要点**:
- `ToolDefinition` 是 Agent 工具调用的统一接口
- 桥接 `SkillDefinition` 和 OpenAI function schema
- `source` 区分来源：skill（Cabinet 技能）、mcp（MCP 工具）、builtin（内置工具）

### 4.3 结构化输出

**文件**: `src/cabinet/agents/structured.py`

```python
class StructuredOutputConfig(BaseModel):
    schema_type: str = "json"  # "json", "json_schema"
    schema_def: dict | None = None
    pydantic_model: str | None = None

class StructuredOutputParser:
    def parse(self, content: str, config: StructuredOutputConfig) -> dict: ...
    def validate(self, data: dict, schema: dict) -> dict: ...
```

**解析策略**（按优先级）:
1. 直接 JSON 解析
2. 从 markdown code block 中提取 JSON
3. 正则提取 JSON 片段
4. 失败则返回 `{"raw_content": content}`

**在 LiteLLMAgent 中的集成**:

```python
async def execute_structured(
    self, task: str, context: AgentContext, output_schema: dict
) -> AgentOutput:
    kwargs = {
        "messages": self._build_messages(task, context),
        "response_format": {"type": "json_object"},
        **context.model_dump(),
    }
    response = await self._gateway.complete(**kwargs)
    parsed = self._output_parser.parse(response.content, StructuredOutputConfig(schema_def=output_schema))
    return AgentOutput(content=response.content, employee_id=self._employee.id, structured_data=parsed, token_usage=response.usage)
```

### 4.4 Agent 能力发现 — CapabilityRegistry

**文件**: `src/cabinet/agents/capability.py`

```python
class AgentCapability(BaseModel):
    agent_id: UUID
    role: str
    skills: list[str] = []
    specializations: list[str] = []
    max_concurrent_tasks: int = 1
    current_load: int = 0

class CapabilityRegistry:
    def __init__(self, employee_store: JsonEmployeeStore, tool_registry: LocalToolRegistry): ...

    async def register(self, agent_id: UUID, capability: AgentCapability) -> None: ...
    async def discover(self, query: str, role: str | None = None, skill: str | None = None) -> list[AgentCapability]: ...
    async def get_capability(self, agent_id: UUID) -> AgentCapability | None: ...
    async def update_load(self, agent_id: UUID, delta: int) -> None: ...
```

## 5. L3 生命周期 + 动态组队层

### 5.1 Agent 池化 — AgentPool

**文件**: `src/cabinet/agents/pool.py`

```python
class AgentState(str, Enum):
    IDLE = "idle"
    BUSY = "busy"
    WAITING = "waiting"
    ERROR = "error"
    TERMINATED = "terminated"

class PooledAgent(BaseModel):
    agent_id: UUID
    employee: Employee
    state: AgentState = AgentState.IDLE
    current_task: str | None = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_active_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    total_tasks: int = 0
    error_count: int = 0

class AgentPool:
    def __init__(self, factory: AgentFactory, mailbox_router: MailboxRouter, max_per_role: int = 3): ...

    async def acquire(self, role: str, employee_id: UUID | None = None) -> PooledAgent:
        """
        获取可用 Agent。
        优先复用 IDLE 的同角色 Agent；
        若无可用且未达 max_per_role 上限，创建新 Agent 并注册 mailbox；
        若已达上限，等待直到有 Agent 释放（最多 30 秒超时，超时抛出 PoolExhaustedError）。
        """
    async def release(self, agent_id: UUID) -> None: ...
    async def get_state(self, agent_id: UUID) -> AgentState | None: ...
    async def set_state(self, agent_id: UUID, state: AgentState, task: str | None = None) -> None: ...
    async def terminate(self, agent_id: UUID) -> None: ...
    async def list_by_role(self, role: str) -> list[PooledAgent]: ...
    async def list_idle(self, role: str | None = None) -> list[PooledAgent]: ...
    async def health_check(self) -> dict: ...
```

**Agent 状态机**:

```
IDLE ──acquire──> BUSY ──release──> IDLE
                    │
                    ├──wait for input──> WAITING ──input received──> BUSY
                    │
                    ├──error──> ERROR ──recovered──> IDLE
                    │
                    └──terminate──> TERMINATED
```

**设计要点**:
- `acquire/release` 模式，类似数据库连接池
- `max_per_role` 限制每种角色最多创建的实例数
- 达到上限时 `acquire` 会等待释放，30 秒超时抛出 `PoolExhaustedError`
- `AgentPool` 持有 `MailboxRouter` 引用，新建 Agent 时自动创建并注册 mailbox
- mailbox 通过 `AgentPool.get_mailbox(agent_id)` 获取，不存储在 PooledAgent 模型中

### 5.2 动态团队组建 — TeamComposer

**文件**: `src/cabinet/agents/composer.py`

```python
class TeamRequirement(BaseModel):
    roles: list[str] = []
    skills: list[str] = []
    min_members: int = 2
    max_members: int = 5
    expertise_areas: list[str] = []

class ComposedTeam(BaseModel):
    team_id: UUID = Field(default_factory=uuid4)
    members: list[PooledAgent]
    workspace: SharedWorkspace
    requirement: TeamRequirement
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class TeamComposer:
    def __init__(
        self,
        agent_pool: AgentPool,
        capability_registry: CapabilityRegistry,
        workspace_factory: Callable[[UUID], SharedWorkspace],
    ): ...

    async def compose(self, requirement: TeamRequirement) -> ComposedTeam: ...
    async def dissolve(self, team_id: UUID) -> None: ...
    async def add_member(self, team_id: UUID, role: str) -> PooledAgent | None: ...
    async def remove_member(self, team_id: UUID, agent_id: UUID) -> None: ...
```

**组队算法**:
1. 按角色需求从 AgentPool 获取 Agent
2. 按技能需求补充 Agent（通过 CapabilityRegistry 发现）
3. 检查 min_members/max_members 约束
4. 创建 SharedWorkspace 绑定到团队
5. 注册所有成员的 Mailbox 到 MailboxRouter

### 5.3 协商/辩论 — DebateProtocol

**文件**: `src/cabinet/agents/debate.py`

```python
class DebatePosition(BaseModel):
    agent_id: UUID
    stance: str  # "support", "oppose", "neutral"
    argument: str
    evidence: list[str] = []

class DebateRound(BaseModel):
    round_number: int
    positions: list[DebatePosition]
    summary: str | None = None

class DebateConfig(BaseModel):
    topic: str
    participants: list[UUID]
    max_rounds: int = 3
    require_consensus: bool = False
    judge_id: UUID | None = None

class DebateResult(BaseModel):
    topic: str
    rounds: list[DebateRound]
    consensus_reached: bool
    final_decision: str | None = None
    dissenting_opinions: list[str] = []

class DebateProtocol:
    async def run_debate(
        self, config: DebateConfig, context: dict, agents: dict[UUID, LiteLLMAgent]
    ) -> DebateResult: ...
```

**辩论流程**:
1. 每轮每个参与者提交立场（support/oppose/neutral）+ 论点 + 证据
2. 检查是否达成共识（所有立场一致）
3. 如果未达成共识且未达到最大轮次，继续下一轮
4. 如果有裁判 Agent，由裁判做最终决定
5. 返回辩论结果（共识/裁决 + 异议列表）

### 5.4 Agent 级别错误恢复 — AgentRecovery

**文件**: `src/cabinet/agents/recovery.py`

```python
class RecoveryStrategy(str, Enum):
    RETRY = "retry"
    FALLBACK_AGENT = "fallback_agent"
    FALLBACK_MODEL = "fallback_model"
    SIMPLIFY_TASK = "simplify_task"
    ESCALATE = "escalate"

class RecoveryConfig(BaseModel):
    max_retries: int = 2
    retry_delay_base: float = 1.0
    strategies: list[RecoveryStrategy] = [
        RecoveryStrategy.RETRY,
        RecoveryStrategy.FALLBACK_MODEL,
        RecoveryStrategy.FALLBACK_AGENT,
        RecoveryStrategy.ESCALATE,
    ]

class AgentRecovery:
    def __init__(
        self,
        agent_pool: AgentPool,
        capability_registry: CapabilityRegistry,
        dead_letter_queue: DeadLetterQueue | None = None,
    ): ...

    async def execute_with_recovery(
        self,
        agent: LiteLLMAgent,
        task: str,
        context: AgentContext,
        config: RecoveryConfig = RecoveryConfig(),
    ) -> AgentOutput: ...
```

**恢复策略优先级**:

| 策略 | 说明 |
|------|------|
| `RETRY` | 指数退避重试（最多 max_retries 次） |
| `FALLBACK_MODEL` | 切换到更稳定的模型重试 |
| `FALLBACK_AGENT` | 找同角色的其他 Agent 执行 |
| `SIMPLIFY_TASK` | 简化任务描述后重试 |
| `ESCALATE` | 上报给 Captain 处理 |

**与死信队列集成**: 所有策略失败后，将任务推入 DeadLetterQueue。

## 6. L4 集成打通层

### 6.1 CrewAI 适配器完善

**文件**: 修改 `src/cabinet/agents/crewai_adapter/`

**agent.py 改进**:
- `tools` 从 `ToolRegistryAdapter` 动态获取，不再硬编码 `tools=[]`
- `reflect()` 真正实现：让 Agent 反思并改进输出
- `memory=True` 启用 CrewAI 记忆
- 支持 `SharedWorkspace` 注入

**team.py 改进**:
- 为每个 Agent 创建独立的 `CrewAITask`，而非单 Task
- 支持 `Process.sequential` 和 `Process.hierarchical`
- `memory=True` 启用团队记忆
- 不再直接访问私有属性 `_crewai_agent`，改用公共方法

### 6.2 WorkflowEngine 与 Agent 真正集成

**文件**: 修改 `src/cabinet/core/workflow/engine.py`

重写 `_execute_skill()`:

1. **优先使用 AgentPool**: 获取池化 Agent → 构建任务 → 执行 → 释放
2. **其次使用 ToolRegistry**: 直接执行技能
3. **降级使用 LLM 描述**: 保持向后兼容

新增构造参数:
- `agent_pool: AgentPool | None`
- `tool_registry: LocalToolRegistry | None`

### 6.3 Decision 委派真正实现

**文件**: 修改 `src/cabinet/rooms/decision/service.py`

集成 `HandoffManager`:
- `delegate()` 创建 `HandoffRequest`，通过 `HandoffManager` 交接
- 接受交接后更新决策状态和委派目标
- 拒绝交接后回退决策状态

新增构造参数:
- `handoff_manager: HandoffManager | None`
- `agent_pool: AgentPool | None`

### 6.4 Runtime 组装更新

**文件**: 修改 `src/cabinet/runtime.py`

新增组件初始化和注入:

```python
class CabinetRuntime:
    def __init__(
        self,
        # ... existing params
        agent_pool: AgentPool | None = None,
        mailbox_router: MailboxRouter | None = None,
        handoff_manager: HandoffManager | None = None,
        capability_registry: CapabilityRegistry | None = None,
        team_composer: TeamComposer | None = None,
        agent_recovery: AgentRecovery | None = None,
    ): ...
```

组装顺序:
1. `MailboxRouter` — 无依赖
2. `AgentPool(factory, mailbox_router)` — 依赖 AgentFactory + MailboxRouter
3. `HandoffManager(mailbox_router)` — 依赖 MailboxRouter
4. `CapabilityRegistry(employee_store, tool_registry)` — 依赖 EmployeeStore + ToolRegistry
5. `TeamComposer(agent_pool, capability_registry, workspace_factory)` — 依赖 AgentPool + CapabilityRegistry
6. `AgentRecovery(agent_pool, capability_registry, dead_letter_queue)` — 依赖 AgentPool + CapabilityRegistry + DLQ
7. 注入到 Room 服务和 WorkflowEngine

### 6.5 CLI 新命令

```
cabinet team compose --roles strategist,executor --skills analysis --max 4
cabinet team list
cabinet team dissolve <team_id>
cabinet agent pool status
cabinet agent mailbox <agent_id> --send <message> --to <recipient_id>
cabinet debate start --topic "..." --participants agent1,agent2 --rounds 3
```

### 6.6 API 新端点

```
POST   /api/v1/teams/compose          # 动态组队
GET    /api/v1/teams                   # 列出团队
DELETE /api/v1/teams/{team_id}         # 解散团队
GET    /api/v1/agents/pool/status      # Agent 池状态
POST   /api/v1/agents/{id}/message     # 发送消息
GET    /api/v1/agents/{id}/messages    # 获取消息
POST   /api/v1/debates                 # 启动辩论
GET    /api/v1/debates/{id}            # 获取辩论结果
POST   /api/v1/handoffs               # 发起交接
GET    /api/v1/handoffs/pending/{id}   # 获取待处理交接
```

## 7. 数据库迁移

新增迁移 `v006_multi_agent.sql`:

```sql
-- Agent 消息记录
CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    msg_type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    reply_to TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient ON agent_messages(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_sender ON agent_messages(sender_id, created_at);

-- 交接记录
CREATE TABLE IF NOT EXISTS handoff_requests (
    id TEXT PRIMARY KEY,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT NOT NULL,
    task_description TEXT NOT NULL,
    context_snapshot TEXT DEFAULT '{}',
    reason TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    deadline TEXT,
    status TEXT DEFAULT 'pending',
    response_message TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_handoff_to_agent ON handoff_requests(to_agent_id, status);

-- 团队记录
CREATE TABLE IF NOT EXISTS composed_teams (
    id TEXT PRIMARY KEY,
    requirement TEXT NOT NULL,
    member_ids TEXT NOT NULL,
    workspace_snapshot TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    dissolved_at TEXT
);

-- 辩论记录
CREATE TABLE IF NOT EXISTS debates (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    config TEXT NOT NULL,
    rounds TEXT NOT NULL,
    consensus_reached INTEGER DEFAULT 0,
    final_decision TEXT,
    dissenting_opinions TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
);

-- Agent 能力注册
CREATE TABLE IF NOT EXISTS agent_capabilities (
    agent_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    skills TEXT DEFAULT '[]',
    specializations TEXT DEFAULT '[]',
    max_concurrent_tasks INTEGER DEFAULT 1,
    current_load INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_role ON agent_capabilities(role);
```

## 8. 新文件清单

| 文件 | 层 | 说明 |
|------|-----|------|
| `src/cabinet/agents/mailbox.py` | L1 | AgentMailbox + MailboxRouter |
| `src/cabinet/agents/handoff.py` | L1 | HandoffManager |
| `src/cabinet/agents/workspace.py` | L1 | SharedWorkspace |
| `src/cabinet/agents/dialogue.py` | L1 | DialogueOrchestrator |
| `src/cabinet/agents/tools.py` | L2 | ToolDefinition + ToolRegistryAdapter |
| `src/cabinet/agents/structured.py` | L2 | StructuredOutputParser |
| `src/cabinet/agents/capability.py` | L2 | CapabilityRegistry |
| `src/cabinet/agents/pool.py` | L3 | AgentPool |
| `src/cabinet/agents/composer.py` | L3 | TeamComposer |
| `src/cabinet/agents/debate.py` | L3 | DebateProtocol |
| `src/cabinet/agents/recovery.py` | L3 | AgentRecovery |
| `src/cabinet/core/events/migrations/v006_multi_agent.py` | L4 | 数据库迁移 |

## 9. 修改文件清单

| 文件 | 层 | 变更说明 |
|------|-----|---------|
| `src/cabinet/agents/context.py` | L1 | AgentOutput 增强字段 |
| `src/cabinet/agents/llm_agent.py` | L2 | 添加 function calling + structured output |
| `src/cabinet/agents/crewai_adapter/agent.py` | L4 | 工具注入 + reflect 实现 |
| `src/cabinet/agents/crewai_adapter/team.py` | L4 | 多 Task + process 选择 |
| `src/cabinet/core/workflow/engine.py` | L4 | _execute_skill 真正执行 |
| `src/cabinet/rooms/decision/service.py` | L4 | delegate 真正交接 |
| `src/cabinet/runtime.py` | L4 | 组装新组件 |
| `src/cabinet/cli/main.py` | L4 | 新 CLI 命令 |
| `src/cabinet/api/routes/agents.py` | L4 | 新 API 端点 |

## 10. 依赖关系

```
L1: AgentMailbox ← HandoffManager ← (L3: AgentRecovery)
L1: SharedWorkspace ← (L3: TeamComposer)
L1: DialogueOrchestrator ← (L3: DebateProtocol)
L2: ToolDefinition ← LiteLLMAgent.tools
L2: CapabilityRegistry ← (L3: TeamComposer, AgentRecovery)
L3: AgentPool ← TeamComposer, AgentRecovery
L3: DebateProtocol ← (L4: MeetingRoom 增强)
L4: 所有 L1-L3 组件 → Runtime 组装
L4: WorkflowEngine ← AgentPool + ToolRegistry
L4: DecisionRoom ← HandoffManager + AgentPool
```
