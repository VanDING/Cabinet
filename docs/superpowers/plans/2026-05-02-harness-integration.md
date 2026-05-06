# Harness 深度集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Harness 三件套（DefaultEvaluator / WorkflowVerificationGate / DefaultEscalationProtocol）注入到 Runtime 和 Room Service，替换内联 LLM 调用逻辑，建立统一的质量保障和安全网链路。

**Architecture:** OfficeSchedulerService 注入 VerificationGate，在 execute_workflow() 节点完成后增加质量验证；DecisionRoomService 注入 EscalationProtocol，在 check_authorization() 中替换内联 evaluator Agent 调用；CabinetRuntime 组装 Harness 组件并注入 Room Service。所有新参数默认 None 保证向后兼容。

**Tech Stack:** Python 3.12+, Pydantic v2, pytest + pytest-asyncio

---

### Task 1: OfficeSchedulerService 注入 VerificationGate

**Files:**
- Modify: `src/cabinet/rooms/office/service.py:30-40` (构造函数)
- Modify: `src/cabinet/rooms/office/service.py:168-199` (execute_workflow)
- Test: `tests/unit/rooms/office/test_service.py`

- [ ] **Step 1: 写失败测试 — execute_workflow 有 VerificationGate 时调用 check()**

在 `tests/unit/rooms/office/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_execute_workflow_with_verification_gate(publisher):
    from cabinet.core.harness.models import GateResult
    from uuid import UUID

    checked_nodes: list[UUID] = []

    class MockVerificationGate:
        async def check(self, node_id: UUID, context: dict) -> GateResult:
            checked_nodes.append(node_id)
            return GateResult(passed=True)

    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), verification_gate=MockVerificationGate())
    execution = await service.execute_workflow(uuid4(), {"input": "data"})
    assert len(checked_nodes) == 1
    assert execution.status in ("running", "completed")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/rooms/office/test_service.py::test_execute_workflow_with_verification_gate -v`
Expected: FAIL — `OfficeSchedulerService.__init__() got an unexpected keyword argument 'verification_gate'`

- [ ] **Step 3: 修改 OfficeSchedulerService 构造函数**

修改 `src/cabinet/rooms/office/service.py` 构造函数，添加 `verification_gate` 参数：

```python
from __future__ import annotations

import re
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import TaskFailure, TaskOrder, TaskStatusUpdate
from cabinet.rooms.office.domain_events import (
    TaskCancelled,
    TaskFailed,
    TaskStatusChanged,
    TaskSubmitted,
    WorkflowCompleted,
    WorkflowNodeCompleted,
    WorkflowStarted,
)
from cabinet.rooms.office.models import (
    PermissionLevel,
    PermissionVerdict,
    Task,
    TaskStatus,
    WorkflowExecution,
)


class OfficeSchedulerService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        verification_gate: object | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._verification_gate = verification_gate
        self._tasks: dict[UUID, Task] = {}
        self._executions: dict[UUID, WorkflowExecution] = {}
```

- [ ] **Step 4: 修改 execute_workflow 方法，增加质量验证**

替换 `src/cabinet/rooms/office/service.py` 中的 `execute_workflow` 方法：

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

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/office/test_service.py -v`
Expected: ALL PASS

- [ ] **Step 6: 写失败测试 — VerificationGate 检查失败时记录 gate_results**

在 `tests/unit/rooms/office/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_execute_workflow_gate_failed_records_gate_result(publisher):
    from cabinet.core.harness.models import GateResult
    from uuid import UUID

    class FailingVerificationGate:
        async def check(self, node_id: UUID, context: dict) -> GateResult:
            return GateResult(passed=False, reason="Quality below threshold", retry_allowed=True)

    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), verification_gate=FailingVerificationGate())
    execution = await service.execute_workflow(uuid4(), {"input": "data"})
    assert len(execution.gate_results) == 1
    gate = list(execution.gate_results.values())[0]
    assert gate.passed is False
    assert gate.reason == "Quality below threshold"
```

- [ ] **Step 7: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/office/test_service.py::test_execute_workflow_gate_failed_records_gate_result -v`
Expected: PASS

- [ ] **Step 8: 写测试 — verification_gate=None 时行为不变（向后兼容）**

在 `tests/unit/rooms/office/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_execute_workflow_without_verification_gate(publisher):
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory())
    execution = await service.execute_workflow(uuid4(), {"input": "data"})
    assert execution.status in ("running", "completed")
    assert len(execution.gate_results) == 0
```

- [ ] **Step 9: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/office/test_service.py::test_execute_workflow_without_verification_gate -v`
Expected: PASS

- [ ] **Step 10: 提交**

```bash
git add src/cabinet/rooms/office/service.py tests/unit/rooms/office/test_service.py
git commit -m "feat(office): inject VerificationGate into execute_workflow for quality verification"
```

---

### Task 2: DecisionRoomService 注入 EscalationProtocol

**Files:**
- Modify: `src/cabinet/rooms/decision/service.py:28-38` (构造函数)
- Modify: `src/cabinet/rooms/decision/service.py:233-262` (check_authorization)
- Test: `tests/unit/rooms/decision/test_service.py`

- [ ] **Step 1: 写失败测试 — check_authorization 有 EscalationProtocol 时委托给它**

在 `tests/unit/rooms/decision/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_check_authorization_with_escalation_protocol(publisher):
    from cabinet.core.harness.escalation import DefaultEscalationProtocol

    rules = [AuthorizationRule(
        captain_id="cap1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
    )]
    protocol = DefaultEscalationProtocol(rules=rules)
    store = RoomEventStore("decision")
    service = DecisionRoomService(store, publisher, StubAgentFactory(), escalation_protocol=protocol)

    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="routine task",
        description="auto-approvable",
        captain_id="cap1",
    )
    verdict = await service.check_authorization(decision)
    assert verdict.auto_process is True
    assert verdict.requires_captain is False
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/rooms/decision/test_service.py::test_check_authorization_with_escalation_protocol -v`
Expected: FAIL — `DecisionRoomService.__init__() got an unexpected keyword argument 'escalation_protocol'`

- [ ] **Step 3: 修改 DecisionRoomService 构造函数**

修改 `src/cabinet/rooms/decision/service.py` 构造函数，添加 `escalation_protocol` 参数：

```python
class DecisionRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        escalation_protocol: object | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._escalation_protocol = escalation_protocol
        self._decisions: dict[UUID, Decision] = {}
        self._rules: dict[UUID, AuthorizationRule] = {}
```

- [ ] **Step 4: 修改 check_authorization 方法，委托给 EscalationProtocol**

替换 `src/cabinet/rooms/decision/service.py` 中的 `check_authorization` 方法：

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

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/decision/test_service.py::test_check_authorization_with_escalation_protocol -v`
Expected: PASS

- [ ] **Step 6: 写测试 — STRATEGIC 决策通过 EscalationProtocol 升级到 Captain**

在 `tests/unit/rooms/decision/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_check_authorization_escalation_strategic(publisher):
    from cabinet.core.harness.escalation import DefaultEscalationProtocol

    protocol = DefaultEscalationProtocol(rules=[])
    store = RoomEventStore("decision")
    service = DecisionRoomService(store, publisher, StubAgentFactory(), escalation_protocol=protocol)

    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="market direction",
        description="Which market to enter",
        captain_id="cap1",
    )
    verdict = await service.check_authorization(decision)
    assert verdict.requires_captain is True
    assert verdict.auto_process is False
    assert "strategic" in verdict.reason.lower()
```

- [ ] **Step 7: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/decision/test_service.py::test_check_authorization_escalation_strategic -v`
Expected: PASS

- [ ] **Step 8: 写测试 — escalation_protocol=None 时行为不变（向后兼容）**

在 `tests/unit/rooms/decision/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_check_authorization_without_escalation_protocol(publisher):
    store = RoomEventStore("decision")
    service = DecisionRoomService(store, publisher, StubAgentFactory())

    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="market direction",
        description="Which market to enter",
        captain_id="cap1",
    )
    verdict = await service.check_authorization(decision)
    assert isinstance(verdict, AuthorizationVerdict)
```

- [ ] **Step 9: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/decision/test_service.py::test_check_authorization_without_escalation_protocol -v`
Expected: PASS

- [ ] **Step 10: 提交**

```bash
git add src/cabinet/rooms/decision/service.py tests/unit/rooms/decision/test_service.py
git commit -m "feat(decision): inject EscalationProtocol into check_authorization"
```

---

### Task 3: CabinetRuntime 组装 Harness 组件

**Files:**
- Modify: `src/cabinet/runtime.py` (构造函数 + 新属性)
- Test: `tests/unit/test_runtime.py`

- [ ] **Step 1: 写失败测试 — Runtime 创建 Harness 组件并注入 Room Service**

在 `tests/unit/test_runtime.py` 末尾追加：

```python
def test_runtime_creates_harness_components():
    from cabinet.core.harness.evaluator import DefaultEvaluator
    from cabinet.core.harness.verification_gate import WorkflowVerificationGate
    from cabinet.core.harness.escalation import DefaultEscalationProtocol

    runtime = CabinetRuntime()
    assert isinstance(runtime.evaluator, DefaultEvaluator)
    assert isinstance(runtime.verification_gate, WorkflowVerificationGate)
    assert isinstance(runtime.escalation_protocol, DefaultEscalationProtocol)


def test_runtime_injects_verification_gate_into_office():
    runtime = CabinetRuntime()
    assert runtime.office._verification_gate is runtime.verification_gate


def test_runtime_injects_escalation_protocol_into_decision():
    runtime = CabinetRuntime()
    assert runtime.decision._escalation_protocol is runtime.escalation_protocol
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/test_runtime.py::test_runtime_creates_harness_components -v`
Expected: FAIL — `AttributeError: 'CabinetRuntime' object has no attribute 'evaluator'`

- [ ] **Step 3: 修改 CabinetRuntime 构造函数**

替换 `src/cabinet/runtime.py` 全部内容：

```python
from __future__ import annotations

from cabinet.agents.protocol import AgentFactory
from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.core.harness.escalation import DefaultEscalationProtocol
from cabinet.core.harness.evaluator import DefaultEvaluator
from cabinet.core.harness.verification_gate import WorkflowVerificationGate
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.service import SummaryRoomService


class CabinetRuntime:
    def __init__(self, agent_factory: AgentFactory | None = None, gateway: object | None = None):
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

        self._meeting_handler = MeetingEventHandler()
        self._strategy_handler = StrategyEventHandler()
        self._decision_handler = DecisionEventHandler(self._decision)
        self._office_handler = OfficeEventHandler(self._office)
        self._summary_handler = SummaryEventHandler(self._summary)
        self._secretary_handler = SecretaryEventHandler(self._secretary)

    async def start(self) -> None:
        await self._wiring.register(self._meeting_handler)
        await self._wiring.register(self._strategy_handler)
        await self._wiring.register(self._decision_handler)
        await self._wiring.register(self._office_handler)
        await self._wiring.register(self._summary_handler)
        await self._wiring.register(self._secretary_handler)

    async def stop(self) -> None:
        pass

    @property
    def bus(self) -> AsyncIOEventBus:
        return self._bus

    @property
    def wiring(self) -> RoomEventWiring:
        return self._wiring

    @property
    def evaluator(self) -> DefaultEvaluator:
        return self._evaluator

    @property
    def verification_gate(self) -> WorkflowVerificationGate:
        return self._verification_gate

    @property
    def escalation_protocol(self) -> DefaultEscalationProtocol:
        return self._escalation_protocol

    @property
    def meeting(self) -> MeetingRoomService:
        return self._meeting

    @property
    def strategy(self) -> StrategyDecoderService:
        return self._strategy

    @property
    def decision(self) -> DecisionRoomService:
        return self._decision

    @property
    def office(self) -> OfficeSchedulerService:
        return self._office

    @property
    def summary(self) -> SummaryRoomService:
        return self._summary

    @property
    def secretary(self) -> SecretaryAgentService:
        return self._secretary

    @property
    def store(self):
        return self._bus._store
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/test_runtime.py -v`
Expected: ALL PASS

- [ ] **Step 5: 写测试 — Runtime 带 gateway 参数时 Evaluator 使用 gateway**

在 `tests/unit/test_runtime.py` 末尾追加：

```python
def test_runtime_with_gateway_creates_evaluator_with_gateway():
    from unittest.mock import AsyncMock
    from cabinet.core.gateway.protocol import ModelGateway

    gateway = AsyncMock(spec=ModelGateway)
    runtime = CabinetRuntime(gateway=gateway)
    assert runtime.evaluator._gateway is gateway
```

- [ ] **Step 6: 运行测试确认通过**

Run: `python -m pytest tests/unit/test_runtime.py::test_runtime_with_gateway_creates_evaluator_with_gateway -v`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/runtime.py tests/unit/test_runtime.py
git commit -m "feat(runtime): assemble Harness components and inject into Room Services"
```

---

### Task 4: 全量测试验证 + ruff check

**Files:**
- 无新文件

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest -q --no-header`
Expected: ALL PASSED (测试数量应 >= 397)

- [ ] **Step 2: 运行 ruff check**

Run: `python -m ruff check src/`
Expected: 0 errors

- [ ] **Step 3: 验证 Harness 协议合规**

Run: `python -c "from cabinet.core.harness.protocol import Evaluator, VerificationGate, EscalationProtocol; from cabinet.core.harness.evaluator import DefaultEvaluator; from cabinet.core.harness.verification_gate import WorkflowVerificationGate; from cabinet.core.harness.escalation import DefaultEscalationProtocol; assert isinstance(DefaultEvaluator(), Evaluator); assert isinstance(WorkflowVerificationGate(), VerificationGate); assert isinstance(DefaultEscalationProtocol(rules=[]), EscalationProtocol); print('OK')"`
Expected: `OK`

- [ ] **Step 4: 提交最终状态**

```bash
git add -A
git commit -m "chore: Harness deep integration complete — all tests pass"
```
