# 跨室事件流闭环 + 技术债清理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 StrategyEventHandler 打通五室事件流管道，清理所有 pass 占位符和技术债

**Architecture:** StrategyEventHandler 消费 deliberation.proposal 并委托 StrategyDecoderService.decode() 解码提案；CabinetRuntime.stop() 通过新增的 wiring.unregister_all() 注销所有 handler；Secretary 填充 3 个空事件分支的状态追踪；LoopNode 实现循环体迭代执行

**Tech Stack:** Python 3.12+, pytest, pytest-asyncio, Pydantic v2

---

### Task 1: StrategyEventHandler 消费 deliberation.proposal

**Files:**
- Modify: `src/cabinet/rooms/strategy/event_handler.py`
- Modify: `tests/unit/rooms/strategy/test_event_handler.py`
- Modify: `src/cabinet/runtime.py` (传入 strategy 依赖)

- [ ] **Step 1: 更新测试 — 修改 contract 断言并新增 handle 测试**

替换 `tests/unit/rooms/strategy/test_event_handler.py` 全部内容：

```python
import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.models.events import DeliberationProposal, MessageEnvelope
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.protocol import StrategyDecoder


def test_strategy_handler_satisfies_protocol():
    room = AsyncMock(spec=StrategyDecoder)
    handler = StrategyEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_strategy_handler_contract():
    room = AsyncMock(spec=StrategyDecoder)
    handler = StrategyEventHandler(room)
    contract = handler.contract
    assert isinstance(contract, EventContract)
    assert contract.room_name == "strategy"
    assert "strategy.decode_result" in contract.produces
    assert "deliberation.proposal" in contract.consumes


@pytest.mark.asyncio
async def test_strategy_handler_handles_deliberation_proposal():
    room = AsyncMock(spec=StrategyDecoder)
    handler = StrategyEventHandler(room)

    proposal = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:strategy"],
        message_type="deliberation.proposal",
        payload=proposal.model_dump(),
    )
    await handler.handle(env)
    room.decode.assert_awaited_once()
    call_args = room.decode.call_args
    assert call_args[0][0].proposal.proposal_text == "expand market"


@pytest.mark.asyncio
async def test_strategy_handler_ignores_unknown_event():
    room = AsyncMock(spec=StrategyDecoder)
    handler = StrategyEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:strategy"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.decode.assert_not_awaited()
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/rooms/strategy/test_event_handler.py -v`
Expected: FAIL — StrategyEventHandler() 缺少 room 参数，consumes 不匹配

- [ ] **Step 3: 实现 StrategyEventHandler**

替换 `src/cabinet/rooms/strategy/event_handler.py` 全部内容：

```python
from __future__ import annotations

import logging
from typing import TYPE_CHECKING
from uuid import uuid4

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import DeliberationProposal, MessageEnvelope
from cabinet.rooms.meeting.models import ConvergenceResult, DeliberationOutput, DeliberationResult
from cabinet.rooms.strategy.models import DecodeContext

if TYPE_CHECKING:
    from cabinet.rooms.strategy.protocol import StrategyDecoder

logger = logging.getLogger(__name__)


class StrategyEventHandler:
    def __init__(self, room: StrategyDecoder):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="strategy",
            produces=["strategy.decode_result"],
            consumes=["deliberation.proposal"],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        if envelope.message_type != "deliberation.proposal":
            return
        proposal = DeliberationProposal(**envelope.payload)
        deliberation_output = DeliberationOutput(
            session_id=envelope.correlation_id,
            proposal=DeliberationResult(
                session_id=envelope.correlation_id,
                proposal_text=proposal.proposal_text,
                confidence=proposal.confidence,
                reasoning_summary=proposal.reasoning_summary,
                convergence=ConvergenceResult(consensus="auto", dissent=[], unresolved=[]),
                rounds_used=0,
                rumination_detected=False,
            ),
        )
        context = DecodeContext(project_id=uuid4(), existing_constraints=[])
        await self._room.decode(deliberation_output, context)
```

- [ ] **Step 4: 更新 CabinetRuntime 传入 strategy 依赖**

修改 `src/cabinet/runtime.py` 第61行：

将：
```python
        self._strategy_handler = StrategyEventHandler()
```
改为：
```python
        self._strategy_handler = StrategyEventHandler(self._strategy)
```

- [ ] **Step 5: 运行测试验证通过**

Run: `python -m pytest tests/unit/rooms/strategy/test_event_handler.py tests/unit/test_runtime.py -v`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/rooms/strategy/event_handler.py tests/unit/rooms/strategy/test_event_handler.py src/cabinet/runtime.py
git commit -m "feat: implement StrategyEventHandler consuming deliberation.proposal"
```

---

### Task 2: CabinetRuntime.stop() 资源清理

**Files:**
- Modify: `src/cabinet/core/events/wiring.py` (新增 unregister_all)
- Modify: `src/cabinet/runtime.py` (实现 stop)
- Modify: `tests/unit/core/events/test_wiring.py` (新增 unregister_all 测试)
- Modify: `tests/unit/test_runtime.py` (新增 stop 测试)

- [ ] **Step 1: 新增 wiring.unregister_all 测试**

在 `tests/unit/core/events/test_wiring.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_wiring_unregister_all(bus):
    wiring = RoomEventWiring(bus)
    handled = []

    class FakeHandler:
        @property
        def contract(self):
            return EventContract(
                room_name="decision",
                produces=["decision.response"],
                consumes=["deliberation.proposal"],
            )

        async def handle(self, envelope: MessageEnvelope) -> None:
            handled.append(envelope)

    handler = FakeHandler()
    await wiring.register(handler)
    assert "decision" in wiring._handlers

    await wiring.unregister_all()
    assert len(wiring._handlers) == 0

    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "test"},
    )
    await bus.publish(env)
    assert len(handled) == 0
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/events/test_wiring.py::test_wiring_unregister_all -v`
Expected: FAIL — AttributeError: 'RoomEventWiring' object has no attribute 'unregister_all'

- [ ] **Step 3: 实现 RoomEventWiring.unregister_all()**

在 `src/cabinet/core/events/wiring.py` 的 `RoomEventWiring` 类中，`resolve_recipients` 方法后追加：

```python
    async def unregister_all(self) -> None:
        for handler in self._handlers.values():
            for msg_type in handler.contract.consumes:
                await self._bus.unsubscribe(msg_type, handler.handle)
        self._handlers.clear()
```

- [ ] **Step 4: 运行 wiring 测试验证通过**

Run: `python -m pytest tests/unit/core/events/test_wiring.py -v`
Expected: ALL PASS

- [ ] **Step 5: 新增 CabinetRuntime.stop() 测试**

在 `tests/unit/test_runtime.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_runtime_stop_clears_handlers():
    runtime = CabinetRuntime()
    await runtime.start()
    assert len(runtime.wiring._handlers) == 6
    await runtime.stop()
    assert len(runtime.wiring._handlers) == 0
```

- [ ] **Step 6: 实现 CabinetRuntime.stop()**

修改 `src/cabinet/runtime.py` 第76-77行：

将：
```python
    async def stop(self) -> None:
        pass
```
改为：
```python
    async def stop(self) -> None:
        await self._wiring.unregister_all()
```

- [ ] **Step 7: 运行全部相关测试验证通过**

Run: `python -m pytest tests/unit/test_runtime.py tests/unit/core/events/test_wiring.py tests/integration/test_runtime.py -v`
Expected: ALL PASS

- [ ] **Step 8: 提交**

```bash
git add src/cabinet/core/events/wiring.py src/cabinet/runtime.py tests/unit/core/events/test_wiring.py tests/unit/test_runtime.py
git commit -m "feat: implement CabinetRuntime.stop() with handler cleanup"
```

---

### Task 3: Secretary 空事件分支填充

**Files:**
- Modify: `src/cabinet/rooms/secretary/service.py`
- Modify: `tests/unit/rooms/secretary/test_service.py`

- [ ] **Step 1: 新增 Secretary 状态追踪测试**

在 `tests/unit/rooms/secretary/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_process_input_tracks_history(service):
    context = InteractionContext(captain_id="cap1")
    await service.process_input("hello", context)
    await service.process_input("status?", context)
    assert "cap1" in service._inputs
    assert len(service._inputs["cap1"]) == 2


@pytest.mark.asyncio
async def test_summarize_pending_tracks_latest(service):
    await service.summarize_pending("cap1")
    assert "cap1" in service._pending_summaries


@pytest.mark.asyncio
async def test_filter_decision_tracks_result(service):
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="small task",
        description="auto",
        captain_id="cap1",
    )
    await service.filter_decision(decision)
    assert decision.id in service._filtered_decisions
    assert service._filtered_decisions[decision.id].auto_action == "auto_approve"


@pytest.mark.asyncio
async def test_restore_includes_input_history(service, publisher):
    context = InteractionContext(captain_id="cap1")
    await service.process_input("hello", context)
    new_service = SecretaryAgentService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert "cap1" in new_service._inputs
    assert len(new_service._inputs["cap1"]) == 1
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py::test_process_input_tracks_history tests/unit/rooms/secretary/test_service.py::test_summarize_pending_tracks_latest tests/unit/rooms/secretary/test_service.py::test_filter_decision_tracks_result -v`
Expected: FAIL — AttributeError: 'SecretaryAgentService' object has no attribute '_inputs'

- [ ] **Step 3: 实现 Secretary 状态追踪**

修改 `src/cabinet/rooms/secretary/service.py`：

3a. 在 `__init__` 中，第41行 `self._notifications` 后追加：

```python
        self._inputs: dict[str, list[str]] = {}
        self._pending_summaries: dict[str, str] = {}
        self._filtered_decisions: dict[UUID, FilterResult] = {}
```

3b. 替换 `_apply_event` 中的 3 个 `pass` 分支（第47-49行、第49-50行、第68-69行）：

将：
```python
        elif isinstance(event, InputProcessed):
            pass
        elif isinstance(event, PendingSummarized):
            pass
```
改为：
```python
        elif isinstance(event, InputProcessed):
            self._inputs.setdefault(event.captain_id, []).append(event.response_text)
        elif isinstance(event, PendingSummarized):
            self._pending_summaries[event.captain_id] = event.summary_text
```

将：
```python
        elif isinstance(event, DecisionFiltered):
            pass
```
改为：
```python
        elif isinstance(event, DecisionFiltered):
            if event.filter_result is not None:
                self._filtered_decisions[event.decision_id] = event.filter_result
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/rooms/secretary/service.py tests/unit/rooms/secretary/test_service.py
git commit -m "feat: fill Secretary empty event branches with state tracking"
```

---

### Task 4: LoopNode 循环体迭代执行

**Files:**
- Modify: `src/cabinet/core/workflow/engine.py`
- Modify: `tests/unit/core/workflow/test_engine.py`

- [ ] **Step 1: 更新 LoopNode 测试 — 替换骨架断言为迭代执行断言**

替换 `tests/unit/core/workflow/test_engine.py` 中的 `test_engine_loop_node_skeleton` 函数（第136-161行）：

将：
```python
@pytest.mark.asyncio
async def test_engine_loop_node_skeleton():
    trigger_id = uuid4()
    loop_id = uuid4()
    body_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, iterator_expr="items", body_node_ids=[body_id]),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"items": [1, 2, 3]})
    assert str(loop_id) in results
    assert results[str(loop_id)]["loop_iterator"] == "items"
    assert "note" in results[str(loop_id)]
```
改为：
```python
@pytest.mark.asyncio
async def test_engine_loop_node_executes_body():
    trigger_id = uuid4()
    loop_id = uuid4()
    body_a_id = uuid4()
    body_b_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, iterator_expr="items", body_node_ids=[body_a_id, body_b_id]),
            SkillNode(id=body_a_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=body_b_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"items": [1, 2, 3]})
    assert str(loop_id) in results
    loop_result = results[str(loop_id)]
    assert "iterations" in loop_result
    assert loop_result["total"] == 2
    assert len(loop_result["iterations"]) == 2
    assert loop_result["iterations"][0]["index"] == 0
    assert loop_result["iterations"][1]["index"] == 1
    assert "output" in loop_result["iterations"][0]
    assert "output" in loop_result["iterations"][1]
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_loop_node_executes_body -v`
Expected: FAIL — 断言 "iterations" in loop_result 失败（当前返回 "loop_iterator" 和 "note"）

- [ ] **Step 3: 实现 LoopNode 循环体迭代执行**

修改 `src/cabinet/core/workflow/engine.py` 第143-148行：

将：
```python
        if isinstance(node, LoopNode):
            return NodeResult(node.id, {
                "loop_iterator": node.iterator_expr,
                "body_node_ids": [str(nid) for nid in node.body_node_ids],
                "note": "loop skeleton - iteration not executed",
            })
```
改为：
```python
        if isinstance(node, LoopNode):
            iteration_results = []
            for i, body_id in enumerate(node.body_node_ids):
                body_node = node_map.get(body_id)
                if body_node is None:
                    continue
                iter_context = dict(context_data)
                iter_context["__loop_index__"] = i
                iter_context["__loop_total__"] = len(node.body_node_ids)
                result = await self._execute_node(body_node, iter_context, node_map, edge_map)
                iteration_results.append({"index": i, "output": result.output})
                context_data.update(result.output)
            return NodeResult(node.id, {
                "iterations": iteration_results,
                "total": len(node.body_node_ids),
            })
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/workflow/engine.py tests/unit/core/workflow/test_engine.py
git commit -m "feat: implement LoopNode body iteration execution"
```

---

### Task 5: 全量验证

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest -v`
Expected: ALL PASS (420+ tests)

- [ ] **Step 2: 运行 ruff check**

Run: `ruff check src/ tests/`
Expected: 0 errors

- [ ] **Step 3: 协议合规验证**

Run: `python -m pytest tests/unit/rooms/strategy/test_protocol.py tests/unit/rooms/strategy/test_event_handler.py tests/unit/core/events/test_wiring.py -v`
Expected: ALL PASS — StrategyEventHandler 满足 RoomEventHandler 协议，contract 正确
