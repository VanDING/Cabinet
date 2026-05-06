# MVP CLI 补全设计

日期：2026-05-03

## 背景

Cabinet 核心架构（6 室 + 事件驱动 + LLM Agent + MCP/知识库/记忆）已全部实现，CLI 可用性第一批（API Key 管理、模型配置、init 增强、serve 修复）已完成。但 MVP 标准仍有 2 项未达标：

- `cabinet employee add` 创建 Employee 并挂载 Skill — 未实现
- `cabinet skill run` 执行一个原子 Skill — 未实现

此外还有 3 个架构缺口：
- KnowledgeBase 未在 CLI 中实例化（ChromaDBKnowledgeBase 存在但从未注入）
- 跨室工作流无法从 CLI 触发（只能通过 Secretary 间接交互）
- Chat 不支持流式输出（Gateway 支持 stream 但未使用）

本设计采用分层扩展方案：先建数据持久化层，再加 CLI 命令层，最后增强 Chat 交互层。

## 设计

### 1. 数据持久化层

#### 1a. JsonEmployeeStore — 员工注册表

当前问题：`LLMAgentFactory.create_agent()` 每次用随机 UUID 创建临时 Employee，无法复用。

新增 `JsonEmployeeStore`，将员工信息持久化到 `data/employees.json`：

```python
class JsonEmployeeStore:
    def __init__(self, path: str = "data/employees.json"):
        self._path = path
        self._employees: dict[UUID, Employee] = {}

    async def initialize(self) -> None: ...    # 从文件加载
    async def add(self, employee: Employee) -> None: ...
    async def get(self, employee_id: UUID) -> Employee | None: ...
    async def list_all(self) -> list[Employee]: ...
    async def mount_skill(self, employee_id: UUID, skill_id: UUID) -> None: ...
    async def save(self) -> None: ...          # 写回文件
```

`LLMAgentFactory` 增加可选 `employee_store` 参数。当 `create_agent(agent_id, role)` 被调用时：
- 如果 `employee_store` 中存在该 `agent_id`，使用已注册的 Employee（含 personality、skills）
- 否则回退到当前的临时创建逻辑

#### 1b. SkillStore — 技能注册表

当前问题：`LocalToolRegistry` 是纯内存的，`SkillLoader` 只能从文件解析但不持久化。

新增 `SkillStore`，启动时从 `data/skills/` 目录自动加载所有 `.md` 技能文件：

```python
class SkillStore:
    def __init__(self, skills_dir: str = "data/skills"):
        self._skills_dir = skills_dir
        self._loader = SkillLoader()

    async def initialize(self, registry: LocalToolRegistry) -> None:
        """扫描 skills_dir，将所有 .md 文件解析并注册到 registry"""
        for path in Path(self._skills_dir).glob("*.md"):
            skill = self._loader.parse_file(str(path))
            await registry.register(skill)

    async def load_skill(self, path: str, registry: LocalToolRegistry) -> SkillDefinition:
        """加载单个技能文件并注册"""
        skill = self._loader.parse_file(path)
        await registry.register(skill)
        # 同时复制到 skills_dir
        return skill
```

#### 1c. KnowledgeBase 注入

当前问题：`_init_runtime` 从未创建 `ChromaDBKnowledgeBase`，`knowledge_base` 参数始终为 None。

在 `_init_runtime` 中创建 ChromaDBKnowledgeBase：

```python
knowledge_base = ChromaDBKnowledgeBase(
    persist_dir=os.path.join(data_dir, "vectors"),
)
kwargs["knowledge_base"] = knowledge_base
```

#### 1d. CabinetConfig 扩展

```python
class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    api_keys: dict[str, str] = {}
    employees_path: str = "data/employees.json"   # 新增
    skills_dir: str = "data/skills"               # 新增
    knowledge_dir: str = "data/knowledge"         # 新增
    created_at: datetime = Field(default_factory=_now)
```

### 2. CLI 命令层

#### 2a. `cabinet employee` 命令组

```bash
cabinet employee add \
  --name "策略顾问" \
  --role "advisor" \
  --personality "提供多角度分析，关注风险和机会" \
  --data-dir data

cabinet employee list [--data-dir data]
```

实现要点：
- `add` 创建 `Employee` 对象，写入 `JsonEmployeeStore`
  - `team_id` 自动生成为 `uuid5(NAMESPACE_DNS, f"team:{role}")`，同一 role 的员工归属同一虚拟团队
  - `kind` 默认为 `"ai"`，可通过 `--kind human` 指定人类员工
- `list` 以 Rich Table 展示已注册员工（ID、名称、角色、技能数）
- `--role` 默认值从 `DEFAULT_ROLE_PROMPTS` 的 key 中选择

#### 2b. `cabinet skill` 命令组

```bash
cabinet skill load <path> [--data-dir data]     # 加载技能文件到注册表
cabinet skill list [--data-dir data]             # 列出已注册技能
cabinet skill run <name> --input key=value ...   # 执行技能
```

实现要点：
- `load`：调用 `SkillLoader.parse_file()` → 注册到 `LocalToolRegistry` → 复制文件到 `data/skills/`
- `list`：以 Rich Table 展示技能（名称、类型、描述、是否需要知识库）
- `run`：需要启动 runtime（调用 `_init_runtime`），然后调用 `registry.execute(skill_name, inputs)`

`run` 的 `--input` 参数支持 `key=value` 格式，解析为 `dict`：
```python
inputs = {}
for item in input_args:
    k, v = item.split("=", 1)
    inputs[k] = v
```

#### 2c. `cabinet knowledge` 命令组

```bash
cabinet knowledge index <path> [--data-dir data]   # 索引文档到知识库
cabinet knowledge query <question> [--data-dir data]  # 查询知识库
```

实现要点：
- `index`：读取文件内容，调用 `knowledge_base.index(documents)`
  - 支持单文件（`.md`, `.txt`）和目录（递归扫描）
  - 每个文件作为一个 document，`content` = 文件内容，`source` = 文件路径
- `query`：调用 `knowledge_base.query(question)`，以 Rich Panel 展示结果

#### 2d. `cabinet init` 增强

在现有 init 基础上，额外创建：
- `data/skills/` 目录（存放技能文件）
- `data/employees.json`（空数组 `[]`）
- 复制内置示例技能 `hello_world.md` 到 `data/skills/`

Next steps 更新为：
```
1. Configure API keys:  cabinet config set-key openai sk-xxx
2. Edit model list:     data/models.json
3. Load a skill:        cabinet skill load <path>
4. Add an employee:     cabinet employee add --name "顾问" --role advisor
5. Start chatting:      cabinet chat
```

### 3. Chat 增强层

#### 3a. 跨室斜杠命令

当前 Chat 只能通过 Secretary 交互。扩展为通过斜杠命令直接访问其他室：

| 命令 | 目标室 | 功能 |
|------|--------|------|
| `/meeting <topic>` | Meeting | 启动审议会话，多视角分析 |
| `/decide <title>` | Decision | 提交决策请求 |
| `/task <description>` | Office | 提交执行任务 |
| `/strategy <proposal>` | Strategy | 战略解码 |
| `/review` | Summary | 启动复盘 |
| `/skills` | ToolRegistry | 列出可用技能 |
| `/employees` | EmployeeStore | 列出已注册员工 |
| `/help` | — | 显示所有斜杠命令 |
| `/status` | Secretary | 已有：待处理摘要 |
| `/quit` | — | 已有：退出 |

实现要点：
- 在 `_chat_async` 的主循环中，解析用户输入，如果以 `/` 开头则路由到对应处理函数
- 每个斜杠命令对应一个 `async def _handle_xxx(runtime, config, args)` 函数
- Secretary 仍然是默认交互界面（非 `/` 开头的输入走 Secretary）

`/meeting` 示例流程：
```python
async def _handle_meeting(runtime, config, args):
    participants = [uuid4(), uuid4()]  # 创建 2 个 advisor
    session = await runtime.meeting.start_session(
        topic=args, level=MeetingLevel.MULTI_PARTY, participants=participants
    )
    for pid in participants:
        await runtime.meeting.add_perspective(session.id, pid)
    await runtime.meeting.cross_validate(session.id)
    result = await runtime.meeting.converge(session.id)
    console.print(Markdown(result.proposal_text))
```

#### 3b. 流式输出

为 `LiteLLMAgent` 添加 `execute_stream()` 方法：

```python
async def execute_stream(self, task: str, context: AgentContext):
    """Yields content chunks, then records history"""
    messages = self._build_messages(task)
    full_content = []
    async for chunk in self._gateway.stream(
        messages=messages, model=context.model, temperature=context.temperature
    ):
        full_content.append(chunk.content)
        yield chunk.content
    self._history.append({"role": "user", "content": task})
    self._history.append({"role": "assistant", "content": "".join(full_content)})
```

Secretary 增加 `process_input_stream()` 方法，返回 `StreamingSecretaryResponse`：

```python
class StreamingSecretaryResponse:
    def __init__(self, stream: AsyncIterator[str], event_coro: Coroutine):
        self.stream = stream       # async generator yielding content chunks
        self._event_coro = event_coro  # 事件发布协程，在流结束后 await

    async def wait_for_event(self):
        await self._event_coro
```

Chat 中使用流式输出替代当前的 `console.print(Markdown(response.message))`：

```python
response = await runtime.secretary.process_input_stream(...)
async for chunk in response.stream:
    console.print(chunk, end="")
await response.wait_for_event()
console.print()
```

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/cabinet/core/tools/skill_store.py` | 新增 SkillStore 类 |
| `src/cabinet/agents/employee_store.py` | 新增 JsonEmployeeStore 类 |
| `src/cabinet/agents/llm_factory.py` | 增加 employee_store 参数，优先查找已注册 Employee |
| `src/cabinet/agents/llm_agent.py` | 增加 execute_stream() 方法，提取 _build_messages() |
| `src/cabinet/rooms/secretary/service.py` | 增加 process_input_stream() 方法 |
| `src/cabinet/cli/config.py` | CabinetConfig 增加 employees_path/skills_dir/knowledge_dir |
| `src/cabinet/cli/main.py` | 新增 employee/skill/knowledge 命令；Chat 斜杠命令；流式输出；init 增强 |
| `src/cabinet/runtime.py` | 增加 employee_store 属性 |

## 测试策略

- JsonEmployeeStore：CRUD + 持久化/加载
- SkillStore：文件扫描 + 注册到 registry
- LLMAgentFactory：已注册 Employee 查找 + 回退
- LiteLLMAgent.execute_stream：流式输出 + 历史记录
- CLI employee add/list：端到端
- CLI skill load/list/run：端到端
- CLI knowledge index/query：端到端
- Chat 斜杠命令路由：单元测试
- _init_runtime：验证 KnowledgeBase 注入
