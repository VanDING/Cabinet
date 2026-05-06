# LLM Agent 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 LLM Agent 集成到 Cabinet 系统中，让秘书和会议室服务真正调用 LLM 进行推理，打通 Captain→秘书→会议室→决策室 的核心流转链路。

**Architecture:** 创建 LiteLLMAgent（基于 ModelGateway 的轻量 Agent）和 LLMAgentFactory（实现 AgentFactory 协议），修改秘书和会议室服务让它们通过 agent_factory 创建 Agent 并调用 execute()。StubAgentFactory 继续用于单元测试，LLMAgentFactory 用于生产环境。

**Tech Stack:** Python 3.12+, Pydantic, LiteLLM, pytest, pytest-asyncio

---

## File Structure

| 文件 | 变更 | 职责 |
|:---|:---|:---|
| `src/cabinet/agents/llm_agent.py` | 新建 | LiteLLMAgent + LLMTeam 实现 |
| `src/cabinet/agents/llm_factory.py` | 新建 | LLMAgentFactory + DEFAULT_ROLE_PROMPTS |
| `src/cabinet/rooms/secretary/service.py` | 修改 | greet/process_input/summarize_pending 调用 Agent |
| `src/cabinet/rooms/secretary/models.py` | 修改 | InteractionContext 增加 channel 字段 |
| `src/cabinet/rooms/meeting/service.py` | 修改 | add_perspective/cross_validate/converge 调用 Agent |
| `src/cabinet/cli/main.py` | 修改 | chat 命令改用秘书 Agent |
| `tests/unit/agents/test_llm_agent.py` | 新建 | LiteLLMAgent/LLMTeam 单元测试 |
| `tests/unit/agents/test_llm_factory.py` | 新建 | LLMAgentFactory 单元测试 |
| `tests/unit/rooms/secretary/test_service.py` | 修改 | 更新 StubAgentFactory 为真实 StubAgentFactory |
| `tests/unit/rooms/meeting/test_service.py` | 修改 | 更新 StubAgentFactory 为真实 StubAgentFactory |

---

### Task 1: MockGateway 测试工具

**Files:**
- Create: `tests/unit/agents/test_llm_agent.py`（MockGateway 定义在此文件内，后续 Task 扩展）

- [ ] **Step 1: 创建测试文件，写入 MockGateway 和基础测试**

```python
# tests/unit/agents/test_llm_agent.py
from __future__ import annotations

import pytest

from cabinet.core.gateway.protocol import ModelChunk, ModelInfo, ModelResponse


class MockGateway:
    def __init__(self, responses: list[str] | None = None):
        self._responses = responses or ["Mock LLM response"]
        self._call_index = 0
        self.calls: list[dict] = []

    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse:
        self.calls.append({
            "messages": messages,
            "model": model,
            "temperature": temperature,
        })
        response = self._responses[self._call_index % len(self._responses)]
        self._call_index += 1
        return ModelResponse(content=response, model=model)

    async def stream(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ):
        yield ModelChunk(content="Mock", model=model)

    def list_models(self) -> list[ModelInfo]:
        return [ModelInfo(id="mock", provider="test")]


@pytest.mark.asyncio
async def test_mock_gateway_complete():
    gateway = MockGateway(responses=["hello"])
    response = await gateway.complete(
        messages=[{"role": "user", "content": "hi"}], model="mock"
    )
    assert response.content == "hello"
    assert response.model == "mock"
    assert len(gateway.calls) == 1


@pytest.mark.asyncio
async def test_mock_gateway_cycles_responses():
    gateway = MockGateway(responses=["first", "second"])
    r1 = await gateway.complete(messages=[], model="mock")
    r2 = await gateway.complete(messages=[], model="mock")
    r3 = await gateway.complete(messages=[], model="mock")
    assert r1.content == "first"
    assert r2.content == "second"
    assert r3.content == "first"
```

- [ ] **Step 2: 运行测试验证 MockGateway**

Run: `pytest tests/unit/agents/test_llm_agent.py -v`
Expected: 2 passed

- [ ] **Step 3: 提交**

```bash
git add tests/unit/agents/test_llm_agent.py
git commit -m "test: add MockGateway test utility for LLM Agent tests"
```

---

### Task 2: LiteLLMAgent + LLMTeam

**Files:**
- Create: `src/cabinet/agents/llm_agent.py`
- Modify: `tests/unit/agents/test_llm_agent.py`

- [ ] **Step 1: 写 LiteLLMAgent 的失败测试**

追加到 `tests/unit/agents/test_llm_agent.py`：

```python
from uuid import uuid4

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.agents.protocol import BaseAgent, BaseTeam
from cabinet.models.primitives import Employee, Team


@pytest.mark.asyncio
async def test_llm_agent_satisfies_base_agent_protocol():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["I am an advisor"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    assert isinstance(agent, BaseAgent)


@pytest.mark.asyncio
async def test_llm_agent_execute_calls_gateway():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["Analysis complete"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext(model="default", temperature=0.7)
    output = await agent.execute("Analyze this topic", context)
    assert isinstance(output, AgentOutput)
    assert output.content == "Analysis complete"
    assert output.employee_id == employee.id
    assert len(gateway.calls) == 1
    assert gateway.calls[0]["messages"][-1]["content"] == "Analyze this topic"


@pytest.mark.asyncio
async def test_llm_agent_execute_includes_system_prompt():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["ok"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway, system_prompt="You are a strategist")
    context = AgentContext()
    await agent.execute("test", context)
    assert gateway.calls[0]["messages"][0]["role"] == "system"
    assert gateway.calls[0]["messages"][0]["content"] == "You are a strategist"


@pytest.mark.asyncio
async def test_llm_agent_execute_auto_system_prompt():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["ok"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext()
    await agent.execute("test", context)
    system_msg = gateway.calls[0]["messages"][0]
    assert system_msg["role"] == "system"
    assert "advisor" in system_msg["content"]


@pytest.mark.asyncio
async def test_llm_agent_execute_maintains_history():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["response1", "response2"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext()
    await agent.execute("first question", context)
    await agent.execute("second question", context)
    second_call_messages = gateway.calls[1]["messages"]
    user_msgs = [m for m in second_call_messages if m["role"] == "user"]
    assistant_msgs = [m for m in second_call_messages if m["role"] == "assistant"]
    assert len(user_msgs) == 2
    assert len(assistant_msgs) == 1
    assert user_msgs[0]["content"] == "first question"
    assert assistant_msgs[0]["content"] == "response1"


@pytest.mark.asyncio
async def test_llm_agent_reflect():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=["initial response", "improved response"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    context = AgentContext()
    original = AgentOutput(content="initial response", employee_id=employee.id)
    reflected = await agent.reflect(original)
    assert isinstance(reflected, AgentOutput)
    assert reflected.content == "improved response"
    assert reflected.employee_id == employee.id


@pytest.mark.asyncio
async def test_llm_team_satisfies_base_team_protocol():
    from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam

    gateway = MockGateway(responses=["team response"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    team = Team(
        project_id=uuid4(), name="test-team", purpose="test", employees=[employee.id]
    )
    llm_team = LLMTeam(team, [agent], gateway)
    assert isinstance(llm_team, BaseTeam)


@pytest.mark.asyncio
async def test_llm_team_dispatch():
    from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam

    gateway = MockGateway(responses=["coordinated result"])
    employee = Employee(
        id=uuid4(), team_id=uuid4(), name="test-agent", role="advisor", kind="ai"
    )
    agent = LiteLLMAgent(employee, gateway)
    team = Team(
        project_id=uuid4(), name="test-team", purpose="test", employees=[employee.id]
    )
    llm_team = LLMTeam(team, [agent], gateway)
    context = TeamContext(model="default")
    output = await llm_team.dispatch("coordinate this task", context)
    assert isinstance(output, TeamOutput)
    assert output.content == "coordinated result"
    assert output.team_id == team.id


@pytest.mark.asyncio
async def test_llm_team_dispatch_includes_agent_descriptions():
    from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam

    gateway = MockGateway(responses=["ok"])
    e1 = Employee(
        id=uuid4(), team_id=uuid4(), name="a1", role="analyst", kind="ai",
        personality="data-driven"
    )
    e2 = Employee(
        id=uuid4(), team_id=uuid4(), name="a2", role="writer", kind="ai",
        personality="creative"
    )
    a1 = LiteLLMAgent(e1, gateway)
    a2 = LiteLLMAgent(e2, gateway)
    team = Team(
        project_id=uuid4(), name="test-team", purpose="test", employees=[e1.id, e2.id]
    )
    llm_team = LLMTeam(team, [a1, a2], gateway)
    context = TeamContext()
    await llm_team.dispatch("work together", context)
    system_msg = gateway.calls[0]["messages"][0]
    assert "analyst" in system_msg["content"]
    assert "writer" in system_msg["content"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/agents/test_llm_agent.py -v -k "llm_agent or llm_team"`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.agents.llm_agent'`

- [ ] **Step 3: 实现 LiteLLMAgent + LLMTeam**

创建 `src/cabinet/agents/llm_agent.py`：

```python
from __future__ import annotations

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.models.primitives import Employee, Team


class LiteLLMAgent:
    def __init__(
        self,
        employee: Employee,
        gateway: ModelGateway,
        system_prompt: str = "",
    ):
        self._employee = employee
        self._gateway = gateway
        self._system_prompt = system_prompt or (
            f"You are a {employee.role}. {employee.personality or ''}"
        )
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

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/agents/test_llm_agent.py -v`
Expected: 12 passed

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/agents/llm_agent.py tests/unit/agents/test_llm_agent.py
git commit -m "feat: add LiteLLMAgent and LLMTeam implementations"
```

---

### Task 3: LLMAgentFactory + DEFAULT_ROLE_PROMPTS

**Files:**
- Create: `src/cabinet/agents/llm_factory.py`
- Create: `tests/unit/agents/test_llm_factory.py`

- [ ] **Step 1: 写 LLMAgentFactory 的失败测试**

创建 `tests/unit/agents/test_llm_factory.py`：

```python
from uuid import uuid4

import pytest

from cabinet.agents.context import AgentContext, TeamContext
from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam
from cabinet.agents.protocol import AgentFactory, BaseAgent, BaseTeam
from cabinet.core.gateway.protocol import ModelResponse


class MockGateway:
    def __init__(self, responses: list[str] | None = None):
        self._responses = responses or ["Mock LLM response"]
        self._call_index = 0

    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse:
        response = self._responses[self._call_index % len(self._responses)]
        self._call_index += 1
        return ModelResponse(content=response, model=model)

    async def stream(self, messages, model, temperature=0.7, **kwargs):
        yield None

    def list_models(self):
        return []


def test_llm_agent_factory_satisfies_protocol():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway()
    factory = LLMAgentFactory(gateway)
    assert isinstance(factory, AgentFactory)


@pytest.mark.asyncio
async def test_create_agent_returns_lite_llm_agent():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway()
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "secretary")
    assert isinstance(agent, BaseAgent)
    assert isinstance(agent, LiteLLMAgent)
    assert agent.employee.role == "secretary"


@pytest.mark.asyncio
async def test_create_agent_uses_role_prompt():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["Hello Captain!"])
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "secretary")
    context = AgentContext()
    output = await agent.execute("greet", context)
    assert output.content == "Hello Captain!"


@pytest.mark.asyncio
async def test_create_agent_with_custom_role_prompts():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["custom response"])
    custom_prompts = {"analyst": "You are a senior financial analyst."}
    factory = LLMAgentFactory(gateway, role_prompts=custom_prompts)
    agent = await factory.create_agent(uuid4(), "analyst")
    assert agent._system_prompt == "You are a senior financial analyst."


@pytest.mark.asyncio
async def test_create_agent_unknown_role_uses_default():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway(responses=["ok"])
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "unknown_role")
    assert isinstance(agent, LiteLLMAgent)
    assert agent.employee.role == "unknown_role"


@pytest.mark.asyncio
async def test_create_team_returns_llm_team():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway()
    factory = LLMAgentFactory(gateway)
    agent1 = await factory.create_agent(uuid4(), "advisor")
    agent2 = await factory.create_agent(uuid4(), "writer")
    team = await factory.create_team([agent1, agent2], "brainstorm ideas")
    assert isinstance(team, BaseTeam)
    assert isinstance(team, LLMTeam)
    assert len(team.team.employees) == 2


@pytest.mark.asyncio
async def test_default_role_prompts_contains_expected_roles():
    from cabinet.agents.llm_factory import DEFAULT_ROLE_PROMPTS

    assert "secretary" in DEFAULT_ROLE_PROMPTS
    assert "advisor" in DEFAULT_ROLE_PROMPTS
    assert "validator" in DEFAULT_ROLE_PROMPTS
    assert "strategist" in DEFAULT_ROLE_PROMPTS
    assert "executor" in DEFAULT_ROLE_PROMPTS
    assert "evaluator" in DEFAULT_ROLE_PROMPTS


@pytest.mark.asyncio
async def test_create_agent_employee_has_personality_from_prompt():
    from cabinet.agents.llm_factory import LLMAgentFactory

    gateway = MockGateway()
    factory = LLMAgentFactory(gateway)
    agent = await factory.create_agent(uuid4(), "secretary")
    assert agent.employee.personality is not None
    assert "Secretary" in agent.employee.personality or "secretary" in agent.employee.personality.lower()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/agents/test_llm_factory.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.agents.llm_factory'`

- [ ] **Step 3: 实现 LLMAgentFactory + DEFAULT_ROLE_PROMPTS**

创建 `src/cabinet/agents/llm_factory.py`：

```python
from __future__ import annotations

from uuid import UUID, uuid4

from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam
from cabinet.agents.protocol import BaseAgent
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.models.primitives import Employee, Team


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
    ):
        self._gateway = gateway
        self._role_prompts = role_prompts or DEFAULT_ROLE_PROMPTS

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
        return LiteLLMAgent(employee, self._gateway, system_prompt=prompt)

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

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/agents/test_llm_factory.py -v`
Expected: 9 passed

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `pytest tests/ -v --tb=short`
Expected: 378 + 9 = 387 passed（原有 + 新增）

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/agents/llm_factory.py tests/unit/agents/test_llm_factory.py
git commit -m "feat: add LLMAgentFactory with DEFAULT_ROLE_PROMPTS"
```

---

### Task 4: 秘书 Agent LLM 集成

**Files:**
- Modify: `src/cabinet/rooms/secretary/service.py`
- Modify: `src/cabinet/rooms/secretary/models.py`
- Modify: `tests/unit/rooms/secretary/test_service.py`

- [ ] **Step 1: 更新 InteractionContext 模型，增加 channel 字段**

修改 `src/cabinet/rooms/secretary/models.py`，在 `InteractionContext` 类中增加 `channel` 字段：

将：
```python
class InteractionContext(BaseModel):
    captain_id: str
    project_id: UUID | None = None
    active_decisions: int = 0
    time_of_day: str = "morning"
    recent_interactions: list[str] = []
```

改为：
```python
class InteractionContext(BaseModel):
    captain_id: str
    project_id: UUID | None = None
    active_decisions: int = 0
    time_of_day: str = "morning"
    recent_interactions: list[str] = []
    channel: str = "terminal"
```

- [ ] **Step 2: 更新测试文件中的 StubAgentFactory**

修改 `tests/unit/rooms/secretary/test_service.py`，将本地 `StubAgentFactory` 替换为真实的 `StubAgentFactory`：

将：
```python
class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass
```

改为：
```python
from cabinet.agents.stub_factory import StubAgentFactory
```

同时更新 fixture：

将：
```python
@pytest.fixture
def service(publisher):
    store = RoomEventStore("secretary")
    return SecretaryAgentService(store, publisher, StubAgentFactory())
```

改为：
```python
@pytest.fixture
def service(publisher):
    store = RoomEventStore("secretary")
    return SecretaryAgentService(store, publisher, StubAgentFactory())
```

（fixture 代码不变，但 `StubAgentFactory` 现在来自 `cabinet.agents.stub_factory`，返回真实的 `StubAgent` 实例）

- [ ] **Step 3: 运行现有测试确认仍通过**

Run: `pytest tests/unit/rooms/secretary/test_service.py -v`
Expected: 6 passed（StubAgent 返回 "Stub response for secretary: ..." 字符串，测试只检查类型和 captain_id）

- [ ] **Step 4: 修改 SecretaryAgentService 的 greet 方法**

修改 `src/cabinet/rooms/secretary/service.py`，在文件顶部增加导入：

```python
from uuid import UUID, uuid4

from cabinet.agents.context import AgentContext
```

将 `greet` 方法改为：

```python
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
```

- [ ] **Step 5: 修改 SecretaryAgentService 的 process_input 方法**

将 `process_input` 方法改为：

```python
    async def process_input(
        self, captain_input: str, context: InteractionContext,
    ) -> SecretaryResponse:
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
```

- [ ] **Step 6: 修改 SecretaryAgentService 的 summarize_pending 方法**

将 `summarize_pending` 方法改为：

```python
    async def summarize_pending(self, captain_id: str) -> PendingSummary:
        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        context = AgentContext(model="default", temperature=0.7)
        output = await agent.execute(
            f"Captain {captain_id} has no pending items. "
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

- [ ] **Step 7: 运行秘书服务测试确认通过**

Run: `pytest tests/unit/rooms/secretary/test_service.py -v`
Expected: 6 passed

- [ ] **Step 8: 运行全量测试确认无回归**

Run: `pytest tests/ -v --tb=short`
Expected: 全部 passed，0 failed

- [ ] **Step 9: 提交**

```bash
git add src/cabinet/rooms/secretary/service.py src/cabinet/rooms/secretary/models.py tests/unit/rooms/secretary/test_service.py
git commit -m "feat: integrate LLM Agent into Secretary service"
```

---

### Task 5: 会议室 Agent LLM 集成

**Files:**
- Modify: `src/cabinet/rooms/meeting/service.py`
- Modify: `tests/unit/rooms/meeting/test_service.py`

- [ ] **Step 1: 更新测试文件中的 StubAgentFactory**

修改 `tests/unit/rooms/meeting/test_service.py`，将本地 `StubAgentFactory` 替换为真实的 `StubAgentFactory`：

将：
```python
class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass
```

改为：
```python
from cabinet.agents.stub_factory import StubAgentFactory
```

- [ ] **Step 2: 运行现有测试确认仍通过**

Run: `pytest tests/unit/rooms/meeting/test_service.py -v`
Expected: 10 passed

- [ ] **Step 3: 修改 MeetingRoomService 的 add_perspective 方法**

修改 `src/cabinet/rooms/meeting/service.py`，在文件顶部增加导入：

```python
from cabinet.agents.context import AgentContext
```

将 `add_perspective` 方法签名和实现改为：

```python
    async def add_perspective(
        self, session_id: UUID, agent_id: UUID, content: str | None = None,
    ) -> Perspective:
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
```

- [ ] **Step 4: 修改 MeetingRoomService 的 cross_validate 方法**

将 `cross_validate` 方法改为：

```python
    async def cross_validate(
        self, session_id: UUID,
        dissent_items: list[DissentItem] | None = None,
    ) -> ConvergenceResult:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        dissent = dissent_items or []
        perspectives = self._perspectives.get(session_id, [])

        agent = await self._agent_factory.create_agent(uuid4(), "validator")
        context = AgentContext(model="default", temperature=0.3)
        perspectives_text = "\n".join(
            f"[{p.agent_id}]: {p.content}" for p in perspectives
        )
        output = await agent.execute(
            f"Cross-validate these perspectives:\n\n{perspectives_text}\n\n"
            f"Identify: 1) Consensus points 2) Dissent points 3) Unresolved issues",
            context,
        )
        consensus = output.content

        event = CrossValidationCompleted(
            session_id=session_id,
            consensus=consensus,
            dissent=dissent,
            unresolved=[] if not dissent else ["dissent unresolved"],
        )
        await self._publish_and_apply(event)
        return self._convergences[session_id]
```

- [ ] **Step 5: 修改 MeetingRoomService 的 converge 方法**

将 `converge` 方法改为：

```python
    async def converge(
        self, session_id: UUID, max_rounds: int = 3,
    ) -> DeliberationResult:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        session = self._sessions[session_id]
        convergence = self._convergences.get(
            session_id,
            ConvergenceResult(consensus="auto", dissent=[], unresolved=[]),
        )
        perspectives = self._perspectives.get(session_id, [])

        agent = await self._agent_factory.create_agent(uuid4(), "advisor")
        context = AgentContext(model="default", temperature=0.5)
        perspectives_text = "\n".join(
            f"[{p.agent_id}]: {p.content}" for p in perspectives
        )
        output = await agent.execute(
            f"Based on these perspectives, formulate a final proposal:\n\n"
            f"{perspectives_text}\n\n"
            f"Provide a clear, actionable proposal with key recommendations.",
            context,
        )
        proposal_text = output.content

        event = ConvergenceAchieved(
            session_id=session_id,
            proposal_text=proposal_text,
            confidence=0.8,
            reasoning_summary="converged",
            convergence=convergence,
            rounds_used=session.round,
            rumination_detected=False,
        )
        await self._publish_and_apply(event)
        return DeliberationResult(
            session_id=session_id,
            proposal_text=proposal_text,
            confidence=0.8,
            reasoning_summary="converged",
            convergence=convergence,
            rounds_used=session.round,
            rumination_detected=False,
        )
```

- [ ] **Step 6: 运行会议室测试确认通过**

Run: `pytest tests/unit/rooms/meeting/test_service.py -v`
Expected: 10 passed

- [ ] **Step 7: 运行全量测试确认无回归**

Run: `pytest tests/ -v --tb=short`
Expected: 全部 passed，0 failed

- [ ] **Step 8: 提交**

```bash
git add src/cabinet/rooms/meeting/service.py tests/unit/rooms/meeting/test_service.py
git commit -m "feat: integrate LLM Agent into Meeting Room service"
```

---

### Task 6: Chat 命令集成

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 修改 _chat_async 函数**

修改 `src/cabinet/cli/main.py` 中的 `_chat_async` 函数：

将：
```python
async def _chat_async(data_dir: str) -> None:
    from cabinet.cli.config import load_config
    from cabinet.core.gateway.config import DEFAULT_MODEL_LIST
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    from rich.markdown import Markdown
    from rich.prompt import Prompt

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    gateway = LiteLLMRouterGateway(model_list=DEFAULT_MODEL_LIST)

    console.print(Panel(
        f"[bold]Cabinet Chat[/bold]\n"
        f"Organization: {config.organization.name}\n\n"
        f"Type [cyan]/quit[/cyan] to exit, [cyan]/status[/cyan] for status",
        title="Cabinet Chat",
    ))

    messages: list[dict] = []
    while True:
        try:
            user_input = Prompt.ask("[bold cyan]You[/bold cyan]")
        except (EOFError, KeyboardInterrupt):
            break

        if user_input.strip() == "/quit":
            break
        if user_input.strip() == "/status":
            console.print(f"Messages in context: {len(messages)}")
            continue
        if not user_input.strip():
            continue

        messages.append({"role": "user", "content": user_input})
        try:
            response = await gateway.complete(messages=messages, model="default")
            messages.append({"role": "assistant", "content": response.content})
            console.print(Markdown(response.content))
            console.print()
        except Exception as e:
            console.print(f"[red]Error:[/red] {e}")
            messages.pop()
```

改为：
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
    runtime = CabinetRuntime(agent_factory=agent_factory)
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

- [ ] **Step 2: 运行 CLI 测试确认通过**

Run: `pytest tests/unit/cli/ -v`
Expected: 全部 passed

- [ ] **Step 3: 运行全量测试确认无回归**

Run: `pytest tests/ -v --tb=short`
Expected: 全部 passed，0 failed

- [ ] **Step 4: 提交**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat: integrate Secretary Agent into cabinet chat command"
```

---

### Task 7: 最终验证

**Files:**
- 无新增/修改

- [ ] **Step 1: 运行全量测试**

Run: `pytest tests/ -v`
Expected: 全部 passed，0 failed

- [ ] **Step 2: 运行 ruff 检查**

Run: `ruff check src/ tests/`
Expected: 0 errors

- [ ] **Step 3: 验证导入**

Run: `python -c "from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam; from cabinet.agents.llm_factory import LLMAgentFactory, DEFAULT_ROLE_PROMPTS; print('OK')"`
Expected: OK

- [ ] **Step 4: 验证协议满足**

Run: `python -c "from cabinet.agents.protocol import AgentFactory; from cabinet.agents.llm_factory import LLMAgentFactory; from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway; from cabinet.core.gateway.config import DEFAULT_MODEL_LIST; g = LiteLLMRouterGateway(model_list=DEFAULT_MODEL_LIST); assert isinstance(LLMAgentFactory(g), AgentFactory); print('Protocol OK')"`

Expected: Protocol OK

- [ ] **Step 5: 统计测试数量**

Run: `pytest tests/ --co -q | tail -1`
Expected: 总测试数 >= 378 + 21（原有 + MockGateway 2 + LiteLLMAgent/LLMTeam 10 + LLMAgentFactory 9）
