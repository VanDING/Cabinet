# LLM Agent 集成设计

> 基于 Brainstorming 技能产出，2026-05-02

## 关键决策

| 决策 | 选择 | 理由 |
|:---|:---|:---|
| Agent 实现方式 | LiteLLMAgent（直接用 ModelGateway） | 比 CrewAI 更轻量、更快、更可控；CrewAI 适配器保留给未来复杂场景 |
| Agent 创建入口 | LLMAgentFactory（实现 AgentFactory 协议） | 与 StubAgentFactory 平行，注入 CabinetRuntime 即可切换 |
| 室服务改造策略 | 渐进式——先改秘书+会议室，其余室服务暂不动 | 核心链路优先，降低风险 |
| Prompt 管理 | 角色 prompt 模板——每个 Agent 角色有预定义的 system prompt | 可测试、可版本化、可社区共享 |
| Chat 集成 | 秘书 Agent 作为唯一入口 | 符合产品文档"秘书是人机交互的唯一窗口" |
| 集成范围 | 核心链路优先：秘书 Agent + 会议室 Agent | 打通 Captain→秘书→会议室→决策室 流转 |

## 架构

```
Captain
  │
  ▼
cabinet chat ──→ SecretaryAgentService.process_input()
                    │
                    ├── agent_factory.create_agent(role="secretary")
                    │       │
                    │       ▼ (LLMAgentFactory)
                    │   LiteLLMAgent ──→ ModelGateway.complete()
                    │                           │
                    │                           ▼
                    │                     LiteLLM Router
                    │                    (gpt-4o-mini / llama3)
                    │
                    ├── 解析意图 → 路由到对应室服务
                    │
                    ├──→ MeetingRoomService.start_session()
                    │        │
                    │        ├── agent_factory.create_agent(role="advisor")
                    │        │       │
                    │        │       ▼
                    │        │   LiteLLMAgent.execute("从XX视角分析...")
                    │        │
                    │        └── add_perspective() × N → cross_validate() → converge()
                    │                │
                    │                ▼
                    │        deliberation.proposal 事件
                    │
                    └──→ DecisionRoomService.submit()
                             │
                             ▼
                     decision.response 事件
```

核心流转：Captain 输入 → 秘书解析意图 → 会议室推理 → 决策室裁决 → 秘书反馈 Captain

## LiteLLMAgent

直接基于 ModelGateway 的轻量 Agent 实现，满足 BaseAgent 协议。

```python
class LiteLLMAgent:
    def __init__(self, employee: Employee, gateway: ModelGateway, system_prompt: str = ""):
        self._employee = employee
        self._gateway = gateway
        self._system_prompt = system_prompt or f"You are a {employee.role}. {employee.personality or ''}"
        self._history: list[dict] = []

    @property
    def employee(self) -> Employee:
        return self._employee

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        messages = [{"role": "system", "content": self._system_prompt}]
        messages.extend(self._history)
        messages.append({"role": "user", "content": task})
        response = await self._gateway.complete(
            messages=messages,
            model=context.model,
            temperature=context.temperature,
        )
        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": response.content})
        return AgentOutput(content=response.content, employee_id=self._employee.id)

    async def reflect(self, output: AgentOutput) -> AgentOutput:
        reflection_prompt = f"Review and improve your previous response:\n\n{output.content}"
        messages = [{"role": "system", "content": self._system_prompt}]
        messages.extend(self._history)
        messages.append({"role": "user", "content": reflection_prompt})
        response = await self._gateway.complete(messages=messages, model="default")
        return AgentOutput(content=response.content, employee_id=self._employee.id)
```

设计要点：
- 内置对话历史（_history），支持多轮对话上下文
- system_prompt 由角色 + personality 自动构建，也可显式指定
- reflect() 让 Agent 审视并改进自己的输出

## LLMTeam

基于 ModelGateway 的轻量 Team 实现，满足 BaseTeam 协议。

```python
class LLMTeam:
    def __init__(self, team: Team, agents: list[LiteLLMAgent], gateway: ModelGateway):
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
            {"role": "system", "content": f"You are a team coordinator. Team members:\n{agent_descriptions}"},
            {"role": "user", "content": task},
        ]
        response = await self._gateway.complete(messages=messages, model=context.model)
        return TeamOutput(content=response.content, team_id=self._team.id)
```

## LLMAgentFactory

```python
class LLMAgentFactory:
    def __init__(self, gateway: ModelGateway, role_prompts: dict[str, str] | None = None):
        self._gateway = gateway
        self._role_prompts = role_prompts or DEFAULT_ROLE_PROMPTS

    async def create_agent(self, agent_id: UUID, role: str) -> LiteLLMAgent:
        employee = Employee(
            id=agent_id,
            team_id=uuid4(),
            name=f"agent-{role}",
            role=role,
            kind="ai",
            personality=self._role_prompts.get(role, ""),
        )
        return LiteLLMAgent(employee, self._gateway, system_prompt=self._role_prompts.get(role, ""))

    async def create_team(self, agents: list[BaseAgent], task: str) -> LLMTeam:
        team = Team(
            project_id=uuid4(),
            name=f"team-{task[:20]}",
            purpose=task,
            employees=[a.employee.id for a in agents],
        )
        return LLMTeam(team, agents, self._gateway)
```

与 StubAgentFactory 的关系：
- StubAgentFactory → 单元测试，返回固定字符串
- LLMAgentFactory → 生产环境，调用真实 LLM
- 两者都实现 AgentFactory 协议，通过 CabinetRuntime.__init__ 的 agent_factory 参数切换

## 默认角色 Prompt 模板

```python
DEFAULT_ROLE_PROMPTS = {
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
```

## 室服务 Agent 化改造

### 改造原则

1. Agent 调用发生在事件发布之前——先获取 LLM 推理结果，再用结果构建领域事件
2. 保持事件溯源三规则不变——状态仅通过 _apply_event 修改
3. 渐进式改造——只改秘书和会议室，其余室服务暂不动
4. 向后兼容——注入 StubAgentFactory 时行为与改造前一致

### 秘书 Agent 改造

SecretaryAgentService 的核心方法改造：

```python
class SecretaryAgentService(EventSourcedRoom):
    async def greet(self, captain_id: str) -> Greeting:
        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        context = AgentContext(model="default", temperature=0.7)
        output = await agent.execute(
            f"Generate a greeting for Captain {captain_id}. "
            f"Include a brief summary of what you can help with today.",
            context,
        )
        event = CaptainGreeted(captain_id=captain_id, greeting_text=output.content)
        await self._publish_and_apply(event)
        return Greeting(
            captain_id=captain_id,
            message=output.content,
            auto_processed_summary="",
            today_highlights=[],
        )

    async def process_input(self, captain_input: str, context: InteractionContext) -> SecretaryResponse:
        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        agent_context = AgentContext(model="default", temperature=0.7)
        output = await agent.execute(
            f"Captain says: {captain_input}\n\n"
            f"Parse this instruction and respond appropriately. "
            f"If it's a question, answer it. If it's a task, acknowledge and plan. "
            f"If it's ambiguous, ask for clarification.",
            agent_context,
        )
        event = InputProcessed(
            captain_id=context.captain_id,
            input_text=captain_input,
            response_text=output.content,
        )
        await self._publish_and_apply(event)
        return SecretaryResponse(message=output.content, level=SecretaryLevel.L1)

    async def summarize_pending(self, captain_id: str) -> PendingSummary:
        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        context = AgentContext(model="default", temperature=0.7)
        pending_count = 0
        output = await agent.execute(
            f"Captain {captain_id} has {pending_count} pending items. "
            f"Generate a concise summary of what needs attention.",
            context,
        )
        event = PendingSummarized(captain_id=captain_id, summary_text=output.content)
        await self._publish_and_apply(event)
        return PendingSummary(
            captain_id=captain_id,
            urgent_count=0,
            strategic_count=0,
            execution_count=0,
            evolution_count=0,
            digest=output.content,
        )
```

### 会议室 Agent 改造

MeetingRoomService 的核心方法改造：

```python
class MeetingRoomService(EventSourcedRoom):
    async def add_perspective(self, session_id: UUID, agent_id: UUID, content: str | None = None) -> Perspective:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")

        if content is None:
            agent = await self._agent_factory.create_agent(agent_id, "advisor")
            session = self._sessions[session_id]
            context = AgentContext(model="default", temperature=0.8)
            output = await agent.execute(
                f"Analyze the following topic from your perspective:\n\n"
                f"Topic: {session.topic}\n"
                f"Meeting Level: {session.level}\n\n"
                f"Provide your analysis, considering risks, opportunities, and trade-offs.",
                context,
            )
            content = output.content

        perspective_id = uuid4()
        session = self._sessions[session_id]
        event = PerspectiveAdded(
            perspective_id=perspective_id,
            session_id=session_id,
            agent_id=agent_id,
            content=content,
            round=session.round,
        )
        await self._publish_and_apply(event)
        return self._perspectives[session_id][-1]

    async def cross_validate(self, session_id: UUID, ...) -> ConvergenceResult:
        perspectives = self._perspectives.get(session_id, [])
        agent = await self._agent_factory.create_agent(uuid4(), "validator")
        context = AgentContext(model="default", temperature=0.3)
        perspectives_text = "\n".join(f"[{p.agent_id}]: {p.content}" for p in perspectives)
        output = await agent.execute(
            f"Cross-validate these perspectives:\n\n{perspectives_text}\n\n"
            f"Identify: 1) Consensus points 2) Dissent points 3) Unresolved issues",
            context,
        )
        # LLM 输出解析策略：将 output.content 整体作为 consensus，
        # dissent 和 unresolved 由验证 Agent 在 prompt 中明确要求输出格式后解析。
        # 当前阶段使用简单策略：LLM 输出作为 consensus，dissent/unresolved 为空列表。
        # 后续可通过结构化输出（JSON mode）改进解析精度。
```

关键改动：
- add_perspective() 的 content 参数变为可选——不传时由 LLM Agent 生成
- cross_validate() 增加验证 Agent 调用
- 向后兼容：传入 content 时跳过 LLM 调用（StubAgentFactory 测试时传固定内容）

## Chat 集成

当前 cabinet chat 直接调用 LiteLLM Gateway，绕过了所有室服务。改造后通过秘书 Agent 进入系统流转：

```python
async def _chat_async(data_dir: str) -> None:
    from cabinet.cli.config import load_config
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    from cabinet.agents.llm_factory import LLMAgentFactory
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    gateway = LiteLLMRouterGateway(model_list=DEFAULT_MODEL_LIST)
    agent_factory = LLMAgentFactory(gateway)
    runtime = CabinetRuntime(agent_factory=agent_factory)
    await runtime.start()

    greeting = await runtime.secretary.greet(captain_id=config.organization.captain_id)
    console.print(Panel(greeting.message, title="Secretary"))

    while True:
        user_input = Prompt.ask("[bold cyan]Captain[/bold cyan]")
        if user_input.strip() == "/quit":
            break
        if user_input.strip() == "/status":
            summary = await runtime.secretary.summarize_pending(
                captain_id=config.organization.captain_id
            )
            console.print(Markdown(summary.digest))
            continue
        if not user_input.strip():
            continue

        response = await runtime.secretary.process_input(
            captain_input=user_input,
            context=InteractionContext(
                captain_id=config.organization.captain_id,
                channel="terminal",
            ),
        )
        console.print(Markdown(response.message))
        console.print()

    await runtime.stop()
```

CabinetRuntime 本身不需要改动——它已经接受 agent_factory 参数。只需在 CLI 层传入 LLMAgentFactory 即可。

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|:---|:---|:---|
| src/cabinet/agents/llm_agent.py | 新建 | LiteLLMAgent + LLMTeam |
| src/cabinet/agents/llm_factory.py | 新建 | LLMAgentFactory + DEFAULT_ROLE_PROMPTS |
| src/cabinet/rooms/secretary/service.py | 修改 | greet/process_input/summarize_pending 调用 Agent |
| src/cabinet/rooms/meeting/service.py | 修改 | add_perspective/cross_validate/converge 调用 Agent |
| src/cabinet/cli/main.py | 修改 | chat 命令改用秘书 Agent |
| tests/unit/agents/test_llm_agent.py | 新建 | LiteLLMAgent/LLMTeam/LLMAgentFactory 单元测试 |
| tests/unit/rooms/test_secretary_llm.py | 新建 | 秘书 Agent LLM 集成测试（用 Mock Gateway） |
| tests/unit/rooms/test_meeting_llm.py | 新建 | 会议室 Agent LLM 集成测试（用 Mock Gateway） |

## 测试策略

| 测试类型 | 方式 | 说明 |
|:---|:---|:---|
| 单元测试 | StubAgentFactory | 现有 378 测试不受影响 |
| Agent 单元测试 | MockGateway | 验证 LiteLLMAgent 正确调用 Gateway |
| 室服务 LLM 测试 | MockGateway | 验证室服务正确使用 Agent 输出 |
| 集成测试 | 真实 LLM（可选） | 标记 @pytest.mark.llm，CI 默认跳过 |

## MockGateway 设计

用于测试的 ModelGateway 替身，返回预设响应：

```python
class MockGateway:
    def __init__(self, responses: list[str] | None = None):
        self._responses = responses or ["Mock LLM response"]
        self._call_index = 0
        self.calls: list[dict] = []

    async def complete(self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs) -> ModelResponse:
        self.calls.append({"messages": messages, "model": model, "temperature": temperature})
        response = self._responses[self._call_index % len(self._responses)]
        self._call_index += 1
        return ModelResponse(content=response, model=model)

    async def stream(self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs):
        yield ModelChunk(content="Mock", model=model)

    def list_models(self) -> list[ModelInfo]:
        return [ModelInfo(id="mock", provider="test")]
```
