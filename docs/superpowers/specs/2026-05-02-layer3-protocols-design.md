# Layer 3 协议铺开设计方案

> 2026-05-02，基于 Brainstorming 技能产出

## 目标

在 Layer 1（基础能力层）+ Layer 2（智能体与协作层）+ 技术债清理全部完成的基础上，全量铺开 Layer 3（工作空间与决策层）的协议接口和数据模型。

策略：**协议优先横向铺开** — 先定义所有室的协议接口和数据模型，后续再逐个实现服务逻辑。

## 架构决策

| 决策 | 选择 | 理由 |
|:---|:---|:---|
| 代码组织 | Room-centric（按五室+秘书分模块） | 与产品叙事完全对齐，降低认知成本 |
| 协议风格 | Python Protocol + runtime_checkable | 与 Layer 1/2 一致，支持依赖倒置 |
| 数据模型 | Pydantic v2 BaseModel | 与现有 models/ 一致 |
| Harness | 在现有 core/harness/ 下新增实现 | 协议接口不变，只加实现类 |
| 事件集成 | 各室通过 EventBus 依赖产出/消费事件 | 松耦合，可审计 |

## 目录结构

```
src/cabinet/rooms/
├── __init__.py
├── meeting/              # 会议室 — 思考层
│   ├── __init__.py
│   ├── protocol.py       # MeetingRoom 协议
│   └── models.py         # 推理会话、视角、收敛结果
├── strategy/             # 战略解码 — 转化层
│   ├── __init__.py
│   ├── protocol.py       # StrategyDecoder 协议
│   └── models.py         # 行动蓝图、行动域、验证结果
├── decision/             # 决策室 — 裁决层
│   ├── __init__.py
│   ├── protocol.py       # DecisionRoom 协议
│   └── models.py         # 决策仪表板、授权规则、决策卡片
├── office/               # 办公室 — 执行层
│   ├── __init__.py
│   ├── protocol.py       # OfficeScheduler 协议
│   └── models.py         # 任务、任务队列、执行结果、权限分级
├── summary/              # 总结室 — 学习层
│   ├── __init__.py
│   ├── protocol.py       # SummaryRoom 协议
│   └── models.py         # 复盘会话、洞察、决策树、改进建议
└── secretary/            # 秘书Agent — 人机交互唯一窗口
    ├── __init__.py
    ├── protocol.py       # SecretaryAgent 协议
    └── models.py         # 问候、响应、交互上下文、通知、过滤结果

src/cabinet/core/harness/
├── protocol.py           # 已有，不变
├── models.py             # 已有，不变
├── evaluator.py          # 新增：DefaultEvaluator 实现
├── verification_gate.py  # 新增：WorkflowVerificationGate 实现
└── escalation.py         # 新增：DefaultEscalationProtocol 实现
```

## 模块 1：会议室（Meeting Room）

**职责**：多视角结构化推理，产出经过内部验证的方案建议

### 协议

```python
class MeetingRoom(Protocol):
    async def start_session(self, topic: str, level: MeetingLevel,
                            participants: list[UUID]) -> DeliberationSession: ...
    async def add_perspective(self, session_id: UUID, agent_id: UUID,
                              content: str) -> Perspective: ...
    async def cross_validate(self, session_id: UUID) -> ConvergenceResult: ...
    async def converge(self, session_id: UUID,
                       max_rounds: int = 3) -> DeliberationResult: ...
    async def wake_expert(self, session_id: UUID, expert_id: UUID) -> None: ...
    async def close_session(self, session_id: UUID) -> DeliberationOutput: ...
```

### 模型

```python
class MeetingLevel(str, Enum):
    FREE_DRAFT = "free_draft"          # 自由草稿室
    MULTI_PARTY = "multi_party"        # 多方推理室
    EXPERT_HEARING = "expert_hearing"  # 专家听证会

class DeliberationSession(BaseModel):
    id: UUID
    project_id: UUID
    topic: str
    level: MeetingLevel
    participants: list[UUID]
    experts: list[UUID] = []
    status: Literal["open", "validating", "converging", "closed"]
    round: int = 1
    created_at: datetime

class Perspective(BaseModel):
    id: UUID
    session_id: UUID
    agent_id: UUID
    content: str
    round: int
    created_at: datetime

class ConvergenceResult(BaseModel):
    consensus: str
    dissent: list[DissentItem]
    unresolved: list[str]

class DissentItem(BaseModel):
    agent_id: UUID
    content: str
    reasoning: str

class DeliberationResult(BaseModel):
    session_id: UUID
    proposal_text: str
    confidence: float
    reasoning_summary: str
    convergence: ConvergenceResult
    rounds_used: int
    rumination_detected: bool

class DeliberationOutput(BaseModel):
    session_id: UUID
    proposal: DeliberationResult
    event_payload: DeliberationProposal  # 直接作为事件总线 payload
```

**设计要点**：
- `converge()` 内置反刍检测（语义相似度函数，非 Agent）和最大 3 轮硬限制
- `cross_validate()` 对比所有 Perspective 的差异点，只对差异点二次采样
- `wake_expert()` 实现专家预注册触发条件匹配，提示 Captain 确认后加入

## 模块 2：战略解码（Strategy Decoder）

**职责**：将会议室的战略方案转化为办公室可执行的结构化行动蓝图

### 协议

```python
class StrategyDecoder(Protocol):
    async def decode(self, proposal: DeliberationOutput,
                     context: DecodeContext) -> ActionBlueprint: ...
    async def validate_blueprint(self, blueprint: ActionBlueprint) -> BlueprintValidation: ...
```

### 模型

```python
class ActionDomain(BaseModel):
    name: str
    goal: str
    constraints: list[str] = []
    success_criteria: list[str] = []
    dependencies: list[str] = []
    risk_checkpoints: list[str] = []

class ActionBlueprint(BaseModel):
    id: UUID
    project_id: UUID
    source_proposal_id: UUID
    domains: list[ActionDomain]
    execution_order: list[list[str]]    # 外层串行，内层并行
    global_constraints: list[str] = []
    created_at: datetime

class BlueprintValidation(BaseModel):
    valid: bool
    issues: list[str] = []
    domain_count_ok: bool               # ≤5
    dependencies_resolved: bool
    criteria_measurable: bool

class DecodeContext(BaseModel):
    project_id: UUID
    captain_id: str
    existing_constraints: list[str] = []
```

**设计要点**：
- `decode()` 边界明确：不分配 Employee、不定义技术实现、不设权限分级
- `validate_blueprint()` 检查行动域数量 ≤5、依赖关系无环、成功标准可验证
- `ActionBlueprint.execution_order` 用嵌套列表表达：外层是串行步骤，内层是可并行的行动域

## 模块 3：决策室（Decision Room）

**职责**：所有待决策点的汇聚与裁决，Captain 的主界面

### 协议

```python
class DecisionRoom(Protocol):
    async def submit(self, request: DecisionRequest) -> Decision: ...
    async def approve(self, decision_id: UUID, option: dict) -> Decision: ...
    async def reject(self, decision_id: UUID, reason: str) -> Decision: ...
    async def delegate(self, decision_id: UUID, delegate_to: str) -> Decision: ...
    async def get_dashboard(self, project_id: UUID) -> DecisionDashboard: ...
    async def set_authorization(self, rule: AuthorizationRule) -> None: ...
    async def check_authorization(self, decision: Decision) -> AuthorizationVerdict: ...
    async def cascade(self, decision: Decision) -> list[Decision]: ...
```

### 模型

```python
class DecisionCard(BaseModel):
    decision: Decision
    urgency_color: Literal["red", "yellow", "blue", "white"]
    summary: str
    options_summary: list[str]
    source_room: str
    created_ago: str

class DecisionDashboard(BaseModel):
    project_id: UUID
    red_cards: list[DecisionCard]
    yellow_cards: list[DecisionCard]
    blue_cards: list[DecisionCard]
    white_cards: list[DecisionCard]
    total_pending: int

class AuthorizationRule(BaseModel):
    id: UUID
    captain_id: str
    decision_type: DecisionType
    auto_approve: bool = False
    conditions: list[str] = []
    budget_threshold: float | None = None
    notify_only: bool = False

class AuthorizationVerdict(BaseModel):
    auto_process: bool
    requires_captain: bool
    reason: str
    matched_rule: UUID | None = None
```

**设计要点**：
- `cascade()` 实现联级触发：战略决策 approved → 自动生成行动决策，行动决策 approved → 自动生成执行决策
- `check_authorization()` 对接 Harness 的 EscalationProtocol，判断是否需要升级
- `DecisionCard` 是面向 Captain 的展示模型，与内部 `Decision` 分离

## 模块 4：办公室（Office）

**职责**：高度可配置的自动化执行中心

### 协议

```python
class OfficeScheduler(Protocol):
    async def submit_task(self, order: TaskOrder) -> Task: ...
    async def cancel_task(self, task_id: UUID) -> None: ...
    async def get_task_status(self, task_id: UUID) -> TaskStatus: ...
    async def list_active_tasks(self, project_id: UUID) -> list[Task]: ...
    async def execute_workflow(self, workflow_id: UUID,
                              inputs: dict) -> WorkflowExecution: ...
    async def check_permission(self, employee_id: UUID,
                               action: str) -> PermissionVerdict: ...
```

### 模型

```python
class PermissionLevel(str, Enum):
    L0 = "L0"  # 禁止
    L1 = "L1"  # 需确认
    L2 = "L2"  # 需通知
    L3 = "L3"  # 完全自主

class Task(BaseModel):
    id: UUID
    project_id: UUID
    employee_id: UUID
    skill_id: UUID
    inputs: dict = {}
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: float = 0.0
    result: dict | None = None
    error: str | None = None
    retry_count: int = 0
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None

class TaskStatus(BaseModel):
    task_id: UUID
    status: str
    progress: float
    message: str | None = None

class WorkflowExecution(BaseModel):
    id: UUID
    workflow_id: UUID
    project_id: UUID
    status: Literal["running", "completed", "failed", "paused"]
    current_node_id: UUID | None = None
    completed_nodes: list[UUID] = []
    results: dict[str, dict] = {}
    gate_results: dict[str, GateResult] = {}
    created_at: datetime

class PermissionVerdict(BaseModel):
    allowed: bool
    level: PermissionLevel
    reason: str | None = None
    requires_approval: bool = False
```

**设计要点**：
- `execute_workflow()` 是工作流引擎的核心入口，遍历 Workflow 节点图，在每个 HumanApprovalNode 处调用 VerificationGate
- `check_permission()` 基于 Employee.permission_level 和操作类型判断
- `WorkflowExecution.gate_results` 记录每个验证闸门的检查结果，确保可审计

## 模块 5：总结室（Summary Room）

**职责**：经验复用、记忆强化、系统进化。只提供洞察和建议，绝不未经授权自动执行

### 协议

```python
class SummaryRoom(Protocol):
    async def start_review(self, project_id: UUID,
                           review_type: ReviewType) -> ReviewSession: ...
    async def generate_insights(self, session_id: UUID) -> list[Insight]: ...
    async def build_decision_tree(self, project_id: UUID) -> DecisionTree: ...
    async def suggest_improvements(self, session_id: UUID) -> list[ImprovementSuggestion]: ...
    async def audit_authorization_usage(self, captain_id: str) -> AuthorizationAudit: ...
```

### 模型

```python
class ReviewType(str, Enum):
    PROJECT_REVIEW = "project_review"
    ORG_OPTIMIZATION = "org_optimization"
    CAPTAIN_INSIGHT = "captain_insight"

class ReviewSession(BaseModel):
    id: UUID
    project_id: UUID
    review_type: ReviewType
    status: Literal["in_progress", "completed"]
    created_at: datetime
    completed_at: datetime | None = None

class Insight(BaseModel):
    id: UUID
    session_id: UUID
    insight_type: str  # prompt_optimization / risk_calibration / skill_suggestion / workflow_adjustment
    content: str
    confidence: float
    auto_applicable: bool
    requires_captain: bool

class DecisionTreeNode(BaseModel):
    id: UUID
    node_type: Literal["root", "branch", "decision", "execution", "anomaly", "external"]
    label: str
    decision_id: UUID | None = None
    outcome: Literal["approved", "rejected", "completed", "failed"] | None = None
    children: list[UUID] = []
    metadata: dict = {}

class DecisionTree(BaseModel):
    project_id: UUID
    root_node_id: UUID
    nodes: dict[UUID, DecisionTreeNode]

class ImprovementSuggestion(BaseModel):
    id: UUID
    session_id: UUID
    category: Literal["skill", "workflow", "authorization", "knowledge"]
    description: str
    impact: Literal["low", "medium", "high"]
    effort: Literal["low", "medium", "high"]
    auto_applicable: bool

class AuthorizationAudit(BaseModel):
    captain_id: str
    period: str
    total_decisions: int
    manually_approved: int
    could_auto_process: int
    suggestion: str | None = None
```

**设计要点**：
- `Insight.auto_applicable` + `requires_captain` 对接自动反馈回路
- `DecisionTree` 基于事件总线日志重建因果链，节点类型对齐产品文档（●◇■▲◆）
- `AuthorizationAudit` 实现"Captain，本月您亲自审批了 N 项决策，其中 M 项本可自动执行"

## 模块 6：秘书 Agent（Secretary）

**职责**：人机交互的唯一窗口，Captain 的"第一副手"

### 协议

```python
class SecretaryAgent(Protocol):
    async def greet(self, captain_id: str) -> Greeting: ...
    async def process_input(self, captain_input: str,
                            context: InteractionContext) -> SecretaryResponse: ...
    async def summarize_pending(self, captain_id: str) -> PendingSummary: ...
    async def notify(self, event: NotificationEvent) -> NotificationResult: ...
    async def filter_decision(self, decision: Decision) -> FilterResult: ...
```

### 模型

```python
class SecretaryLevel(str, Enum):
    L1 = "L1"  # 基础事务处理
    L2 = "L2"  # 信息整合呈现
    L3 = "L3"  # 注意力保护
    L4 = "L4"  # 情感与关系

class Greeting(BaseModel):
    captain_id: str
    message: str
    auto_processed_summary: str
    today_highlights: list[str]

class InteractionContext(BaseModel):
    captain_id: str
    project_id: UUID | None = None
    active_decisions: int = 0
    time_of_day: str = "morning"
    recent_interactions: list[str] = []

class SecretaryResponse(BaseModel):
    message: str
    level: SecretaryLevel
    decision_cards: list[DecisionCard] = []
    actions_taken: list[str] = []
    requires_captain: bool = False

class PendingSummary(BaseModel):
    captain_id: str
    urgent_count: int
    strategic_count: int
    execution_count: int
    evolution_count: int
    digest: str

class NotificationEvent(BaseModel):
    event_type: str
    severity: Literal["info", "warning", "critical"]
    source: str
    content: str
    related_decision_id: UUID | None = None

class NotificationResult(BaseModel):
    delivered: bool
    channel: str
    captain_should_see: bool

class FilterResult(BaseModel):
    should_present: bool
    urgency_override: Literal["red", "yellow", "blue", "white"] | None = None
    auto_action: str | None = None
    reason: str
```

**设计要点**：
- `process_input()` 是核心方法：解析自然语言 → 判断 L1-L4 层级 → 生成决策卡片或自动执行
- `filter_decision()` 对接授权仪表盘：根据 AuthorizationRule 判断是否过滤
- `notify()` 实现异常通知的语气分级：info→平静陈述，critical→清晰直接带紧迫感
- `Greeting` 实现每日首次打开的交互模式

## Harness 实现

在现有 `core/harness/` 下新增实现文件，协议接口不变：

```python
class DefaultEvaluator:
    """基于 LLM 的评估者，独立于执行者验证输出质量"""
    def __init__(self, gateway: ModelGateway): ...
    async def evaluate(self, output: AgentOutput, criteria: list[str]) -> EvaluationResult: ...

class WorkflowVerificationGate:
    """工作流节点执行前的强制性检查点"""
    def __init__(self, evaluator: Evaluator): ...
    async def check(self, node_id: UUID, context: dict) -> GateResult: ...

class DefaultEscalationProtocol:
    """基于决策类型和授权规则的升级协议"""
    def __init__(self, rules: list[AuthorizationRule]): ...
    async def should_escalate(self, decision: Decision) -> EscalationVerdict: ...
    async def auto_handle(self, decision: Decision) -> Decision: ...
```

## 与现有层的集成点

| Layer 3 模块 | 依赖的 Layer 1/2 组件 | 产出的事件消息 |
|:---|:---|:---|
| MeetingRoom | EventBus, ModelGateway, BaseAgent | `deliberation.proposal`, `deliberation.dissent` |
| StrategyDecoder | ModelGateway | `strategy.decode_result` |
| DecisionRoom | EventBus, EscalationProtocol | `decision.request`, `decision.response` |
| OfficeScheduler | EventBus, SkillExecutor, VerificationGate, ToolRegistry | `task.order`, `task.status_update`, `task.failure` |
| SummaryRoom | EventBus, MemoryStore, KnowledgeBase | `summary.insight`, `summary.review_request` |
| SecretaryAgent | ModelGateway, DecisionRoom, EventBus | (消费所有事件，产出交互响应) |

## 交付标准

1. 6 个协议接口（MeetingRoom, StrategyDecoder, DecisionRoom, OfficeScheduler, SummaryRoom, SecretaryAgent）全部定义
2. 约 30 个数据模型全部实现
3. 3 个 Harness 实现类（DefaultEvaluator, WorkflowVerificationGate, DefaultEscalationProtocol）
4. 所有协议有对应的契约测试（runtime_checkable 验证）
5. 所有数据模型有单元测试（构造、序列化、验证）
6. ruff check 零错误
7. 现有 111 个测试继续通过
