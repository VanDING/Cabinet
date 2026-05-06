# Harness 深度集成设计

## 背景

Cabinet 项目已完成 6 室 Agent 化（397 tests passed），但存在严重的"实现-集成鸿沟"：
Harness 三件套（DefaultEvaluator / WorkflowVerificationGate / DefaultEscalationProtocol）已完整实现，但零集成到运行时路径。
Room Service 选择了"内联 LLM 调用"的捷径，绕过了精心设计的协议层。

需注意的是，并非所有内联 LLM 调用都应被 Harness 替换：Office 的 `check_permission()` 虽然也调 evaluator Agent，但权限检查是授权决策而非质量评估，语义不匹配 Evaluator 协议，因此不在替换范围内。

## 目标

将 Harness 组件注入到 Runtime 和 Room Service，替换内联 LLM 调用逻辑，建立统一的质量保障和安全网链路。

## 范围

### 在范围内

1. OfficeSchedulerService 注入 VerificationGate
2. DecisionRoomService 注入 EscalationProtocol
3. CabinetRuntime 组装 Harness 组件
4. 替换 Decision 中的内联 LLM 调用逻辑，Office 的 execute_workflow 增加质量验证

### 不在范围内

- WorkflowEngine（独立任务）
- Strategy/Summary 的 evaluator Agent 替换（语义不同：内容生成 vs 质量评估）
- 持久化、MCP、知识库集成

## 设计决策

### 决策 1：Strategy/Summary 不纳入集成

Strategy 的 `validate_blueprint()` 和 Summary 的 4 个方法（generate_insights / build_decision_tree / suggest_improvements / audit_authorization_usage）虽然调用 evaluator Agent，但语义是**内容生成**而非**质量评估**。Evaluator 协议的 `evaluate(output, criteria) -> EvaluationResult` 设计用于判断输出是否满足质量标准，不适合用于生成新内容。强行替换会混淆职责边界。

### 决策 2：替换内联逻辑，非双路径共存

Room Service 中的内联 LLM 调用逻辑将被替换为 Harness 协议调用。不保留双路径，避免维护负担和语义混淆。通过参数默认 `None` 保证向后兼容。

### 决策 3：VerificationGate 不阻断工作流

`execute_workflow()` 中节点完成后调用 `verification_gate.check()`，但 `GateResult.passed=False` 时不阻断工作流，仅记录 `gate_results`。这是"观察但不干预"策略，与 Harness 驾驭理论的"人类驾驭"原则一致——质量问题记录后由 Captain 决定是否干预。

## 架构变更

### 1. OfficeSchedulerService

#### 构造函数变更

```python
class OfficeSchedulerService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        verification_gate: VerificationGate | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._verification_gate = verification_gate
        self._tasks: dict[UUID, Task] = {}
        self._executions: dict[UUID, WorkflowExecution] = {}
```

注意：不注入 Evaluator 到 Office。`check_permission()` 是授权决策，不是质量评估，语义不匹配 Evaluator 协议。`check_permission()` 保持现有 Agent 调用逻辑不变。

#### execute_workflow() 变更

节点完成后增加质量验证步骤：

```python
async def execute_workflow(self, workflow_id: UUID, inputs: dict) -> WorkflowExecution:
    execution_id = uuid4()
    project_id = inputs.get("project_id", uuid4()) if isinstance(inputs.get("project_id"), UUID) else uuid4()
    event = WorkflowStarted(
        execution_id=execution_id,
        workflow_id=workflow_id,
        project_id=project_id,
    )
    await self._publish_and_apply(event)

    agent = await self._agent_factory.create_agent(uuid4(), "executor")
    context = AgentContext(model="default", temperature=0.3)
    output = await agent.execute(
        f"Execute workflow {workflow_id} with inputs: {inputs}\n\n"
        f"Describe the execution plan and first step results.",
        context,
    )

    node_id = uuid4()
    node_event = WorkflowNodeCompleted(
        execution_id=execution_id,
        node_id=node_id,
        result={"output": output.content},
    )
    await self._publish_and_apply(node_event)

    if self._verification_gate is not None:
        gate_result = await self._verification_gate.check(
            node_id,
            {"output": output.content, "criteria": ["completeness", "accuracy"]},
        )
        if not gate_result.passed:
            self._executions[execution_id] = self._executions[execution_id].model_copy(
                update={
                    "gate_results": {
                        **self._executions[execution_id].gate_results,
                        str(node_id): gate_result,
                    },
                },
            )

    complete_event = WorkflowCompleted(
        execution_id=execution_id,
        results={"default": {"output": output.content}},
    )
    await self._publish_and_apply(complete_event)
    return self._executions[execution_id]
```

#### check_permission() — 不变

`check_permission()` 保持现有 Agent 调用逻辑不变。权限检查是授权决策，不是质量评估，不适合用 Evaluator 协议。

### 2. DecisionRoomService

#### 构造函数变更

```python
class DecisionRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        escalation_protocol: EscalationProtocol | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._escalation_protocol = escalation_protocol
        self._decisions: dict[UUID, Decision] = {}
        self._rules: dict[UUID, AuthorizationRule] = {}
```

#### check_authorization() 变更

保留规则快速匹配路径，未匹配时委托给 EscalationProtocol：

```python
async def check_authorization(self, decision: Decision) -> AuthorizationVerdict:
    for rule in self._rules.values():
        if rule.decision_type == decision.decision_type and rule.auto_approve:
            return AuthorizationVerdict(
                auto_process=True,
                requires_captain=False,
                reason="matched auto-approve rule",
                matched_rule=rule.id,
            )

    if self._escalation_protocol is not None:
        verdict = await self._escalation_protocol.should_escalate(decision)
        if verdict.escalate:
            return AuthorizationVerdict(
                auto_process=False,
                requires_captain=True,
                reason=verdict.reason,
            )
        return AuthorizationVerdict(
            auto_process=True,
            requires_captain=False,
            reason=verdict.reason,
        )

    agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
    context = AgentContext(model="default", temperature=0.2)
    rules_text = "\n".join(
        f"- {rule.decision_type.value}: auto_approve={rule.auto_approve}, conditions={rule.conditions}"
        for rule in self._rules.values()
    )
    output = await agent.execute(
        f"Evaluate authorization for this decision:\n\n"
        f"Decision Type: {decision.decision_type.value}\n"
        f"Title: {decision.title}\n"
        f"Description: {decision.description}\n\n"
        f"Existing Rules:\n{rules_text if rules_text else 'No rules defined'}\n\n"
        f"Should this be auto-processed or require Captain's attention?",
        context,
    )
    auto_process = "auto" in output.content.lower() and "captain" not in output.content.lower()[:100]
    return AuthorizationVerdict(
        auto_process=auto_process,
        requires_captain=not auto_process,
        reason=output.content[:200],
    )
```

### 3. CabinetRuntime

#### 构造函数变更

```python
class CabinetRuntime:
    def __init__(
        self,
        agent_factory: AgentFactory | None = None,
        gateway: ModelGateway | None = None,
    ):
        self._agent_factory = agent_factory or StubAgentFactory()
        self._bus = AsyncIOEventBus()
        self._wiring = RoomEventWiring(self._bus)

        self._evaluator = DefaultEvaluator(gateway=gateway)
        self._verification_gate = WorkflowVerificationGate(evaluator=self._evaluator)
        self._escalation_protocol = DefaultEscalationProtocol(rules=[])

        self._meeting_store = RoomEventStore("meeting")
        self._strategy_store = RoomEventStore("strategy")
        self._decision_store = RoomEventStore("decision")
        self._office_store = RoomEventStore("office")
        self._summary_store = RoomEventStore("summary")
        self._secretary_store = RoomEventStore("secretary")

        self._meeting = MeetingRoomService(self._meeting_store, self._wiring, self._agent_factory)
        self._strategy = StrategyDecoderService(self._strategy_store, self._wiring, self._agent_factory)
        self._decision = DecisionRoomService(
            self._decision_store, self._wiring, self._agent_factory,
            escalation_protocol=self._escalation_protocol,
        )
        self._office = OfficeSchedulerService(
            self._office_store, self._wiring, self._agent_factory,
            verification_gate=self._verification_gate,
        )
        self._summary = SummaryRoomService(self._summary_store, self._wiring, self._agent_factory)
        self._secretary = SecretaryAgentService(self._secretary_store, self._wiring, self._agent_factory)

        # ... handlers unchanged ...
```

新增属性：

```python
@property
def evaluator(self) -> DefaultEvaluator:
    return self._evaluator

@property
def verification_gate(self) -> WorkflowVerificationGate:
    return self._verification_gate

@property
def escalation_protocol(self) -> DefaultEscalationProtocol:
    return self._escalation_protocol
```

## 向后兼容

所有新参数默认 `None`：
- `verification_gate=None` → `execute_workflow()` 不做质量验证
- `escalation_protocol=None` → `check_authorization()` 保持现有内联 Agent 逻辑

现有测试无需修改（因为注入 `None`），新增测试覆盖 Harness 路径。

## 测试策略

### 新增测试

1. **Office + VerificationGate 集成测试**：注入 MockVerificationGate，验证 `execute_workflow()` 调用 `check()` 并记录 `gate_results`
2. **Decision + EscalationProtocol 集成测试**：注入 DefaultEscalationProtocol，验证 `check_authorization()` 走 EscalationProtocol 路径
3. **Runtime 组装测试**：验证 Harness 组件正确注入到 Room Service
4. **向后兼容测试**：验证 `verification_gate=None` / `escalation_protocol=None` 时行为不变

### 测试模式

使用 MockEvaluator / MockVerificationGate 替代真实 LLM 调用，与现有测试模式一致。

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|:---|:---|:---|
| `src/cabinet/rooms/office/service.py` | 修改 | 注入 verification_gate，execute_workflow 增加质量验证 |
| `src/cabinet/rooms/decision/service.py` | 修改 | 注入 escalation_protocol，替换 check_authorization 内联逻辑 |
| `src/cabinet/runtime.py` | 修改 | 创建 Harness 组件并注入 Room Service |
| `tests/unit/rooms/office/test_service.py` | 修改 | 新增 Harness 集成测试 |
| `tests/unit/rooms/decision/test_service.py` | 修改 | 新增 Harness 集成测试 |
| `tests/unit/test_runtime.py` | 修改 | 新增 Runtime Harness 组装测试 |
