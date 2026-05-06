# Cabinet 基础层设计方案

> 基于 Brainstorming 技能产出，2026-05-02

## 关键决策

| 决策 | 选择 |
|:---|:---|
| MVP范围 | 基础层优先（第1层+第2层） |
| 开发语言 | Python |
| 交互界面 | TUI/CLI优先 |
| LLM策略 | 多模型支持（LiteLLM网关） |
| 数据存储 | 纯本地文件（SQLite+文件系统） |
| 架构路径 | 路径B：协议优先（抽象接口层） |

## 项目结构

```
cabinet/
├── pyproject.toml
├── src/
│   └── cabinet/
│       ├── __init__.py
│       ├── core/                     # 第1层：基础能力层
│       │   ├── gateway/              # 模型网关
│       │   │   ├── protocol.py       # ModelGateway 抽象协议
│       │   │   └── litellm_adapter.py
│       │   ├── events/               # 事件总线
│       │   │   ├── protocol.py       # EventBus 抽象协议
│       │   │   ├── message.py        # 消息信封定义
│       │   │   └── asyncio_bus.py    # asyncio 实现
│       │   ├── memory/               # 记忆系统
│       │   │   ├── protocol.py       # MemoryStore 抽象协议
│       │   │   ├── sqlite_store.py   # SQLite 短期记忆
│       │   │   └── vector_store.py   # ChromaDB 长期记忆
│       │   ├── tools/                # 工具注册表 + MCP连接器
│       │   │   ├── protocol.py       # ToolRegistry 抽象协议
│       │   │   ├── registry.py       # 本地注册实现
│       │   │   └── mcp_connector.py  # MCP SDK 连接器
│       │   └── knowledge/            # 知识库
│       │       ├── protocol.py       # KnowledgeBase 抽象协议
│       │       └── local_kb.py       # 本地文件知识库
│       ├── agents/                   # 第2层：智能体与协作层
│       │   ├── protocol.py           # BaseAgent/BaseSkill/BaseTeam 抽象
│       │   ├── crewai_adapter/       # CrewAI 适配器
│       │   │   ├── agent.py
│       │   │   ├── skill.py
│       │   │   └── team.py
│       │   ├── employee.py           # Employee 实现
│       │   ├── skill_executor.py     # 技能执行器
│       │   └── team_engine.py        # 团队协作引擎
│       ├── models/                   # 数据模型 (Pydantic)
│       │   ├── primitives.py         # 核心原语
│       │   ├── decisions.py          # Decision 模型
│       │   ├── workflows.py          # Workflow 节点模型
│       │   └── events.py             # 事件消息类型定义
│       └── cli/                      # TUI/CLI 入口
│           ├── __init__.py
│           └── main.py               # Typer CLI 入口
├── tests/
│   ├── unit/
│   └── integration/
└── data/                             # 本地数据目录 (gitignored)
    ├── db/
    ├── vectors/
    └── knowledge/
```

## 核心协议接口

### 第1层协议

```python
class ModelGateway(Protocol):
    async def complete(self, messages: list[Message], model: str,
                       temperature: float = 0.7, **kwargs) -> ModelResponse: ...
    async def stream(self, messages: list[Message], model: str,
                     temperature: float = 0.7, **kwargs) -> AsyncIterator[ModelChunk]: ...
    def list_models(self) -> list[ModelInfo]: ...

class EventBus(Protocol):
    async def publish(self, envelope: MessageEnvelope) -> None: ...
    async def subscribe(self, message_type: str, handler: EventHandler) -> None: ...
    async def unsubscribe(self, message_type: str, handler: EventHandler) -> None: ...

class MemoryStore(Protocol):
    async def store(self, key: str, value: MemoryItem, scope: MemoryScope) -> None: ...
    async def retrieve(self, key: str, scope: MemoryScope) -> MemoryItem | None: ...
    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]: ...
    async def delete(self, key: str, scope: MemoryScope) -> None: ...

class ToolRegistry(Protocol):
    async def register(self, skill: SkillDefinition) -> None: ...
    async def execute(self, skill_name: str, inputs: dict) -> SkillOutput: ...
    async def list_skills(self) -> list[SkillDefinition]: ...

class KnowledgeBase(Protocol):
    async def index(self, documents: list[Document]) -> None: ...
    async def query(self, question: str, top_k: int = 5) -> list[DocumentChunk]: ...
```

### 第2层协议

```python
class BaseAgent(Protocol):
    @property
    def employee(self) -> Employee: ...
    async def execute(self, task: str, context: AgentContext) -> AgentOutput: ...
    async def reflect(self, output: AgentOutput) -> AgentOutput: ...

class BaseSkill(Protocol):
    @property
    def definition(self) -> SkillDefinition: ...
    async def run(self, inputs: dict, context: SkillContext) -> SkillOutput: ...

class BaseTeam(Protocol):
    @property
    def team(self) -> Team: ...
    async def dispatch(self, task: str, context: TeamContext) -> TeamOutput: ...
```

## 消息信封

```python
class MessageEnvelope(BaseModel):
    message_id: UUID
    correlation_id: UUID
    causation_id: UUID
    sender: str
    recipients: list[str]
    message_type: str
    timestamp: datetime
    status: Literal["active", "processed", "archived"]
    payload: dict
```

## 核心原语数据模型

- Organization, Project, Team, Employee, SkillDefinition, Knowledge, MemoryItem
- Decision (五类分型 + 完整状态生命周期 + 不可变原则)
- 11种事件消息类型 (对齐文档8.3节)

## 错误处理策略

| 层级 | 策略 |
|:---|:---|
| 协议层 | Pydantic 类型系统拦截 |
| 执行层 | 分级重试 + 决策升级 |
| 事件层 | 死信队列 |
| Harness层 | 验证闸门 |

## 测试策略

- 单元测试: pytest + pytest-asyncio
- 集成测试: 事件总线端到端、适配器调用链
- 契约测试: Protocol 运行时检查
- 快照测试: syrupy (消息格式兼容性)

## MVP交付标准

1. `cabinet init` 创建 Organization + Project + 本地数据目录
2. `cabinet serve` 启动事件总线 + Agent运行时
3. `cabinet chat` 通过秘书Agent交互（最小版）
4. `cabinet employee add` 创建Employee并挂载Skill
5. `cabinet skill run` 执行一个原子Skill
6. 事件总线可发布/订阅/追溯因果链
7. LiteLLM网关可调用至少2个模型提供商
8. 所有协议接口有对应的契约测试
