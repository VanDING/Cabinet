# 跨室事件集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现跨室事件集成，为六个室建立完整的事件驱动链路，打通产出/消费管道。

**Architecture:** Event-Driven Room Protocol Extension 方案。不修改现有室协议，创建 RoomEventHandler 协议和 RoomEventWiring 胶水模块。室服务通过 RoomEventPublisher 协议发布事件，EventHandler 将入站事件转译为室方法调用。

**Tech Stack:** Python 3.12+, Pydantic v2, pytest + pytest-asyncio, asyncio EventBus

---

## File Structure

| 操作 | 文件 | 职责 |
|:---|:---|:---|
| Create | `src/cabinet/core/events/wiring.py` | EventContract, RoomEventHandler 协议, RoomEventPublisher 协议, RoomEventWiring 实现 |
| Modify | `src/cabinet/models/events.py` | 新增 SECRETARY_NOTIFICATION 枚举值 + SecretaryNotification payload |
| Create | `src/cabinet/rooms/meeting/event_handler.py` | MeetingEventHandler |
| Create | `src/cabinet/rooms/strategy/event_handler.py` | StrategyEventHandler |
| Create | `src/cabinet/rooms/decision/event_handler.py` | DecisionEventHandler |
| Create | `src/cabinet/rooms/office/event_handler.py` | OfficeEventHandler |
| Create | `src/cabinet/rooms/summary/event_handler.py` | SummaryEventHandler |
| Create | `src/cabinet/rooms/secretary/event_handler.py` | SecretaryEventHandler |
| Create | `tests/unit/core/events/test_wiring.py` | RoomEventWiring + EventContract 单元测试 |
| Create | `tests/unit/rooms/meeting/test_event_handler.py` | MeetingEventHandler 单元测试 |
| Create | `tests/unit/rooms/strategy/test_event_handler.py` | StrategyEventHandler 单元测试 |
| Create | `tests/unit/rooms/decision/test_event_handler.py` | DecisionEventHandler 单元测试 |
| Create | `tests/unit/rooms/office/test_event_handler.py` | OfficeEventHandler 单元测试 |
| Create | `tests/unit/rooms/summary/test_event_handler.py` | SummaryEventHandler 单元测试 |
| Create | `tests/unit/rooms/secretary/test_event_handler.py` | SecretaryEventHandler 单元测试 |
| Modify | `tests/integration/test_layer_integration.py` | 新增跨室事件集成测试 |

---

### Task 1: 扩展 MessageType 和 Payload 模型

**Files:**
- Modify: `src/cabinet/models/events.py`
- Test: `tests/unit/models/test_events.py` (已有)

- [ ] **Step 1: 写失败测试 — 新增 MessageType 枚举值和 SecretaryNotification payload**

在 `tests/unit/models/test_events.py` 末尾追加：

```python
from cabinet.models.events import MessageType, SecretaryNotification


def test_secretary_notification_message_type():
    assert MessageType.SECRETARY_NOTIFICATION.value == "secretary.notification"


def test_secretary_notification_payload():
    notification = SecretaryNotification(
        captain_id="captain-1",
        notification_type="decision_made",
        content="A decision has been approved",
        severity="info",
    )
    assert notification.captain_id == "captain-1"
    assert notification.severity == "info"
    assert notification.related_decision_id is None


def test_secretary_notification_with_decision_id():
    decision_id = uuid.uuid4()
    notification = SecretaryNotification(
        captain_id="captain-1",
        notification_type="urgent_decision",
        content="Urgent decision requires attention",
        severity="critical",
        related_decision_id=decision_id,
    )
    assert notification.related_decision_id == decision_id
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/models/test_events.py -v -k "secretary_notification or SECRETARY_NOTIFICATION"`
Expected: FAIL — `ImportError: cannot import name 'SecretaryNotification'`

- [ ] **Step 3: 实现 — 在 events.py 中新增枚举值和 payload**

在 `src/cabinet/models/events.py` 的 `MessageType` 枚举中追加：

```python
    SECRETARY_NOTIFICATION = "secretary.notification"
```

在文件末尾追加：

```python
class SecretaryNotification(BaseModel):
    captain_id: str
    notification_type: str
    content: str
    severity: Literal["info", "warning", "critical"]
    related_decision_id: UUID | None = None
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/models/test_events.py -v -k "secretary_notification or SECRETARY_NOTIFICATION"`
Expected: PASS

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `pytest tests/ -v`
Expected: 209+ passed, 0 failed

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/models/events.py tests/unit/models/test_events.py
git commit -m "feat: add SECRETARY_NOTIFICATION message type and SecretaryNotification payload"
```

---

### Task 2: 实现 EventContract 模型

**Files:**
- Create: `src/cabinet/core/events/wiring.py`
- Create: `tests/unit/core/events/test_wiring.py`

- [ ] **Step 1: 写失败测试 — EventContract 模型**

创建 `tests/unit/core/events/test_wiring.py`：

```python
from cabinet.core.events.wiring import EventContract


def test_event_contract_creation():
    contract = EventContract(
        room_name="meeting",
        produces=["deliberation.proposal", "deliberation.dissent"],
        consumes=[],
    )
    assert contract.room_name == "meeting"
    assert len(contract.produces) == 2
    assert len(contract.consumes) == 0


def test_event_contract_pure_producer():
    contract = EventContract(
        room_name="meeting",
        produces=["deliberation.proposal"],
        consumes=[],
    )
    assert contract.consumes == []
    assert "deliberation.proposal" in contract.produces


def test_event_contract_consumer():
    contract = EventContract(
        room_name="decision",
        produces=["decision.response"],
        consumes=["deliberation.proposal", "deliberation.dissent"],
    )
    assert "deliberation.proposal" in contract.consumes
    assert len(contract.produces) == 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/core/events/test_wiring.py -v -k "event_contract"`
Expected: FAIL — `ImportError: cannot import name 'EventContract'`

- [ ] **Step 3: 实现 — 创建 wiring.py 包含 EventContract**

创建 `src/cabinet/core/events/wiring.py`：

```python
from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from pydantic import BaseModel

from cabinet.models.events import MessageEnvelope


class EventContract(BaseModel):
    room_name: str
    produces: list[str]
    consumes: list[str]


@runtime_checkable
class RoomEventHandler(Protocol):
    @property
    def contract(self) -> EventContract: ...

    async def handle(self, envelope: MessageEnvelope) -> None: ...


@runtime_checkable
class RoomEventPublisher(Protocol):
    async def publish(self, room_name: str, message_type: str,
                      payload: BaseModel, causation_id: UUID | None = None) -> None: ...
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/core/events/test_wiring.py -v -k "event_contract"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/events/wiring.py tests/unit/core/events/test_wiring.py
git commit -m "feat: add EventContract model and RoomEventHandler/RoomEventPublisher protocols"
```

---

### Task 3: 实现 RoomEventWiring

**Files:**
- Modify: `src/cabinet/core/events/wiring.py`
- Modify: `tests/unit/core/events/test_wiring.py`

- [ ] **Step 1: 写失败测试 — RoomEventWiring 核心功能**

在 `tests/unit/core/events/test_wiring.py` 追加：

```python
import uuid

import pytest

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.wiring import EventContract, RoomEventWiring
from cabinet.models.events import MessageEnvelope


@pytest.fixture
def bus():
    return AsyncIOEventBus()


@pytest.fixture
def wiring(bus):
    return RoomEventWiring(bus)


def test_wiring_satisfies_publisher_protocol(wiring):
    from cabinet.core.events.wiring import RoomEventPublisher
    assert isinstance(wiring, RoomEventPublisher)


@pytest.mark.asyncio
async def test_wiring_publish_creates_envelope(wiring, bus):
    received = []

    async def handler(envelope: MessageEnvelope):
        received.append(envelope)

    await bus.subscribe("deliberation.proposal", handler)

    from cabinet.models.events import DeliberationProposal
    payload = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    await wiring.publish("meeting", "deliberation.proposal", payload)

    assert len(received) == 1
    assert received[0].sender == "room:meeting"
    assert received[0].message_type == "deliberation.proposal"
    assert received[0].payload["proposal_text"] == "expand market"


@pytest.mark.asyncio
async def test_wiring_publish_with_causation_id(wiring, bus):
    received = []

    async def handler(envelope: MessageEnvelope):
        received.append(envelope)

    await bus.subscribe("decision.response", handler)

    cause_id = uuid.uuid4()
    from cabinet.models.events import DecisionResponse
    payload = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    await wiring.publish("decision", "decision.response", payload, causation_id=cause_id)

    assert len(received) == 1
    assert received[0].causation_id == cause_id


@pytest.mark.asyncio
async def test_wiring_register_subscribes_handler(bus):
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

    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "test"},
    )
    await bus.publish(env)

    assert len(handled) == 1
    assert handled[0].message_type == "deliberation.proposal"


@pytest.mark.asyncio
async def test_wiring_resolve_recipients(wiring):
    from cabinet.core.events.wiring import EventContract

    class FakeDecisionHandler:
        @property
        def contract(self):
            return EventContract(
                room_name="decision",
                produces=["decision.response"],
                consumes=["deliberation.proposal"],
            )

        async def handle(self, envelope: MessageEnvelope) -> None:
            pass

    class FakeOfficeHandler:
        @property
        def contract(self):
            return EventContract(
                room_name="office",
                produces=["task.status_update"],
                consumes=["decision.response", "task.order"],
            )

        async def handle(self, envelope: MessageEnvelope) -> None:
            pass

    await wiring.register(FakeDecisionHandler())
    await wiring.register(FakeOfficeHandler())

    recipients = wiring.resolve_recipients("deliberation.proposal")
    assert "room:decision" in recipients

    recipients = wiring.resolve_recipients("decision.response")
    assert "room:office" in recipients

    recipients = wiring.resolve_recipients("task.order")
    assert "room:office" in recipients

    recipients = wiring.resolve_recipients("unknown.event")
    assert recipients == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/core/events/test_wiring.py -v -k "wiring"`
Expected: FAIL — `ImportError: cannot import name 'RoomEventWiring'`

- [ ] **Step 3: 实现 — 在 wiring.py 中添加 RoomEventWiring 类**

在 `src/cabinet/core/events/wiring.py` 末尾追加：

```python
from cabinet.core.events.protocol import EventBus


class RoomEventWiring:
    def __init__(self, bus: EventBus):
        self._bus = bus
        self._handlers: dict[str, RoomEventHandler] = {}

    async def register(self, handler: RoomEventHandler) -> None:
        self._handlers[handler.contract.room_name] = handler
        for msg_type in handler.contract.consumes:
            await self._bus.subscribe(msg_type, handler.handle)

    async def publish(self, room_name: str, message_type: str,
                      payload: BaseModel, causation_id: UUID | None = None) -> None:
        sender = f"room:{room_name}"
        recipients = self.resolve_recipients(message_type)
        envelope = MessageEnvelope(
            sender=sender,
            recipients=recipients,
            message_type=message_type,
            payload=payload.model_dump(),
        )
        if causation_id is not None:
            envelope.causation_id = causation_id
        await self._bus.publish(envelope)

    def resolve_recipients(self, message_type: str) -> list[str]:
        return [
            f"room:{h.contract.room_name}"
            for h in self._handlers.values()
            if message_type in h.contract.consumes
        ]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/core/events/test_wiring.py -v`
Expected: PASS

- [ ] **Step 5: 运行全量测试确认无回归**

Run: `pytest tests/ -v`
Expected: 209+ passed, 0 failed

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/core/events/wiring.py tests/unit/core/events/test_wiring.py
git commit -m "feat: implement RoomEventWiring with register, publish, and resolve_recipients"
```

---

### Task 4: 实现 MeetingEventHandler

**Files:**
- Create: `src/cabinet/rooms/meeting/event_handler.py`
- Create: `tests/unit/rooms/meeting/test_event_handler.py`

- [ ] **Step 1: 写失败测试 — MeetingEventHandler**

创建 `tests/unit/rooms/meeting/test_event_handler.py`：

```python
from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.rooms.meeting.event_handler import MeetingEventHandler


def test_meeting_handler_satisfies_protocol():
    handler = MeetingEventHandler()
    assert isinstance(handler, RoomEventHandler)


def test_meeting_handler_contract():
    handler = MeetingEventHandler()
    contract = handler.contract
    assert isinstance(contract, EventContract)
    assert contract.room_name == "meeting"
    assert "deliberation.proposal" in contract.produces
    assert "deliberation.dissent" in contract.produces
    assert contract.consumes == []


@pytest.mark.asyncio
async def test_meeting_handler_handle_is_noop():
    from cabinet.models.events import MessageEnvelope
    handler = MeetingEventHandler()
    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:meeting"],
        message_type="some.event",
        payload={},
    )
    await handler.handle(env)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/rooms/meeting/test_event_handler.py -v`
Expected: FAIL — `ImportError: cannot import name 'MeetingEventHandler'`

- [ ] **Step 3: 实现 — 创建 MeetingEventHandler**

创建 `src/cabinet/rooms/meeting/event_handler.py`：

```python
from __future__ import annotations

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import MessageEnvelope


class MeetingEventHandler:
    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="meeting",
            produces=["deliberation.proposal", "deliberation.dissent"],
            consumes=[],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        pass
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/rooms/meeting/test_event_handler.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/rooms/meeting/event_handler.py tests/unit/rooms/meeting/test_event_handler.py
git commit -m "feat: add MeetingEventHandler (pure producer)"
```

---

### Task 5: 实现 StrategyEventHandler

**Files:**
- Create: `src/cabinet/rooms/strategy/event_handler.py`
- Create: `tests/unit/rooms/strategy/test_event_handler.py`

- [ ] **Step 1: 写失败测试 — StrategyEventHandler**

创建 `tests/unit/rooms/strategy/test_event_handler.py`：

```python
from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.rooms.strategy.event_handler import StrategyEventHandler


def test_strategy_handler_satisfies_protocol():
    handler = StrategyEventHandler()
    assert isinstance(handler, RoomEventHandler)


def test_strategy_handler_contract():
    handler = StrategyEventHandler()
    contract = handler.contract
    assert isinstance(contract, EventContract)
    assert contract.room_name == "strategy"
    assert "strategy.decode_result" in contract.produces
    assert contract.consumes == []


@pytest.mark.asyncio
async def test_strategy_handler_handle_is_noop():
    from cabinet.models.events import MessageEnvelope
    handler = StrategyEventHandler()
    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:strategy"],
        message_type="some.event",
        payload={},
    )
    await handler.handle(env)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/rooms/strategy/test_event_handler.py -v`
Expected: FAIL — `ImportError: cannot import name 'StrategyEventHandler'`

- [ ] **Step 3: 实现 — 创建 StrategyEventHandler**

创建 `src/cabinet/rooms/strategy/event_handler.py`：

```python
from __future__ import annotations

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import MessageEnvelope


class StrategyEventHandler:
    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="strategy",
            produces=["strategy.decode_result"],
            consumes=[],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        pass
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/rooms/strategy/test_event_handler.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/rooms/strategy/event_handler.py tests/unit/rooms/strategy/test_event_handler.py
git commit -m "feat: add StrategyEventHandler (pure producer)"
```

---

### Task 6: 实现 DecisionEventHandler

**Files:**
- Create: `src/cabinet/rooms/decision/event_handler.py`
- Create: `tests/unit/rooms/decision/test_event_handler.py`

- [ ] **Step 1: 写失败测试 — DecisionEventHandler**

创建 `tests/unit/rooms/decision/test_event_handler.py`：

```python
import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.models.events import (
    DecisionRequest,
    DeliberationDissent,
    DeliberationProposal,
    MessageEnvelope,
    StrategyDecodeResult,
    TaskFailure,
)
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.protocol import DecisionRoom


def test_decision_handler_satisfies_protocol():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_decision_handler_contract():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)
    contract = handler.contract
    assert contract.room_name == "decision"
    assert "decision.response" in contract.produces
    assert "task.order" in contract.produces
    assert "deliberation.proposal" in contract.consumes
    assert "deliberation.dissent" in contract.consumes
    assert "strategy.decode_result" in contract.consumes
    assert "decision.request" in contract.consumes
    assert "task.failure" in contract.consumes


@pytest.mark.asyncio
async def test_decision_handler_handles_deliberation_proposal():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)

    proposal = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload=proposal.model_dump(),
    )
    await handler.handle(env)
    room.submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_decision_handler_handles_decision_request():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)

    request = DecisionRequest(
        decision_id=uuid.uuid4(),
        decision_type="strategic",
        title="Market expansion",
    )
    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:decision"],
        message_type="decision.request",
        payload=request.model_dump(),
    )
    await handler.handle(env)
    room.submit.assert_awaited_once()


@pytest.mark.asyncio
async def test_decision_handler_handles_task_failure():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)

    failure = TaskFailure(
        task_id=uuid.uuid4(),
        error_message="API timeout",
        retry_count=3,
    )
    env = MessageEnvelope(
        sender="room:office",
        recipients=["room:decision"],
        message_type="task.failure",
        payload=failure.model_dump(),
    )
    await handler.handle(env)
    room.cascade.assert_awaited_once()


@pytest.mark.asyncio
async def test_decision_handler_ignores_unknown_event():
    room = AsyncMock(spec=DecisionRoom)
    handler = DecisionEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:decision"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.submit.assert_not_awaited()
    room.cascade.assert_not_awaited()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/rooms/decision/test_event_handler.py -v`
Expected: FAIL — `ImportError: cannot import name 'DecisionEventHandler'`

- [ ] **Step 3: 实现 — 创建 DecisionEventHandler**

创建 `src/cabinet/rooms/decision/event_handler.py`：

```python
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import DecisionRequest, MessageEnvelope, TaskFailure

if TYPE_CHECKING:
    from cabinet.rooms.decision.protocol import DecisionRoom

logger = logging.getLogger(__name__)

_PROPOSAL_TYPES = {"deliberation.proposal", "deliberation.dissent", "strategy.decode_result"}


class DecisionEventHandler:
    def __init__(self, room: DecisionRoom):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="decision",
            produces=["decision.response", "task.order"],
            consumes=[
                "deliberation.proposal",
                "deliberation.dissent",
                "strategy.decode_result",
                "decision.request",
                "task.failure",
            ],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        msg_type = envelope.message_type
        if msg_type in _PROPOSAL_TYPES or msg_type == "decision.request":
            request = DecisionRequest(**envelope.payload)
            await self._room.submit(request)
        elif msg_type == "task.failure":
            failure = TaskFailure(**envelope.payload)
            from cabinet.models.decisions import Decision, DecisionType
            decision = Decision(
                project_id=uuid.uuid4(),
                decision_type=DecisionType.ANOMALY,
                title=f"Task failure: {failure.error_message}",
                description=failure.error_message,
                captain_id="system",
            )
            await self._room.cascade(decision)
        else:
            logger.warning("DecisionEventHandler received unknown event type: %s", msg_type)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/rooms/decision/test_event_handler.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/rooms/decision/event_handler.py tests/unit/rooms/decision/test_event_handler.py
git commit -m "feat: add DecisionEventHandler with proposal/request/failure handling"
```

---

### Task 7: 实现 OfficeEventHandler

**Files:**
- Create: `src/cabinet/rooms/office/event_handler.py`
- Create: `tests/unit/rooms/office/test_event_handler.py`

- [ ] **Step 1: 写失败测试 — OfficeEventHandler**

创建 `tests/unit/rooms/office/test_event_handler.py`：

```python
import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.models.events import DecisionResponse, MessageEnvelope, TaskOrder
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.protocol import OfficeScheduler


def test_office_handler_satisfies_protocol():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_office_handler_contract():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)
    contract = handler.contract
    assert contract.room_name == "office"
    assert "task.status_update" in contract.produces
    assert "task.failure" in contract.produces
    assert "decision.response" in contract.consumes
    assert "task.order" in contract.consumes


@pytest.mark.asyncio
async def test_office_handler_handles_task_order():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)

    order = TaskOrder(
        employee_id=uuid.uuid4(),
        skill_id=uuid.uuid4(),
        inputs={"key": "value"},
    )
    env = MessageEnvelope(
        sender="room:decision",
        recipients=["room:office"],
        message_type="task.order",
        payload=order.model_dump(),
    )
    await handler.handle(env)
    room.submit_task.assert_awaited_once()


@pytest.mark.asyncio
async def test_office_handler_handles_decision_response():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    env = MessageEnvelope(
        sender="room:decision",
        recipients=["room:office"],
        message_type="decision.response",
        payload=response.model_dump(),
    )
    await handler.handle(env)
    room.submit_task.assert_awaited_once()


@pytest.mark.asyncio
async def test_office_handler_ignores_unknown_event():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:office"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.submit_task.assert_not_awaited()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/rooms/office/test_event_handler.py -v`
Expected: FAIL — `ImportError: cannot import name 'OfficeEventHandler'`

- [ ] **Step 3: 实现 — 创建 OfficeEventHandler**

创建 `src/cabinet/rooms/office/event_handler.py`：

```python
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import DecisionResponse, MessageEnvelope, TaskOrder

if TYPE_CHECKING:
    from cabinet.rooms.office.protocol import OfficeScheduler

logger = logging.getLogger(__name__)


class OfficeEventHandler:
    def __init__(self, room: OfficeScheduler):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="office",
            produces=["task.status_update", "task.failure"],
            consumes=["decision.response", "task.order"],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        msg_type = envelope.message_type
        if msg_type == "task.order":
            order = TaskOrder(**envelope.payload)
            await self._room.submit_task(order)
        elif msg_type == "decision.response":
            response = DecisionResponse(**envelope.payload)
            order = TaskOrder(
                employee_id=response.chosen_option.get("employee_id"),
                skill_id=response.chosen_option.get("skill_id"),
                inputs=response.chosen_option.get("inputs", {}),
            )
            await self._room.submit_task(order)
        else:
            logger.warning("OfficeEventHandler received unknown event type: %s", msg_type)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/rooms/office/test_event_handler.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/rooms/office/event_handler.py tests/unit/rooms/office/test_event_handler.py
git commit -m "feat: add OfficeEventHandler with task.order and decision.response handling"
```

---

### Task 8: 实现 SummaryEventHandler

**Files:**
- Create: `src/cabinet/rooms/summary/event_handler.py`
- Create: `tests/unit/rooms/summary/test_event_handler.py`

- [ ] **Step 1: 写失败测试 — SummaryEventHandler**

创建 `tests/unit/rooms/summary/test_event_handler.py`：

```python
import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.models.events import (
    DecisionResponse,
    HarnessEvaluationResult,
    MessageEnvelope,
    SummaryReviewRequest,
    TaskStatusUpdate,
)
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.protocol import SummaryRoom


def test_summary_handler_satisfies_protocol():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_summary_handler_contract():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)
    contract = handler.contract
    assert contract.room_name == "summary"
    assert "summary.insight" in contract.produces
    assert "decision.response" in contract.consumes
    assert "task.status_update" in contract.consumes
    assert "summary.review_request" in contract.consumes
    assert "harness.evaluation_result" in contract.consumes


@pytest.mark.asyncio
async def test_summary_handler_handles_review_request():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    request = SummaryReviewRequest(
        project_id=uuid.uuid4(),
        review_type="project_review",
    )
    env = MessageEnvelope(
        sender="timer:system",
        recipients=["room:summary"],
        message_type="summary.review_request",
        payload=request.model_dump(),
    )
    await handler.handle(env)
    room.start_review.assert_awaited_once()


@pytest.mark.asyncio
async def test_summary_handler_handles_decision_response():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    env = MessageEnvelope(
        sender="room:decision",
        recipients=["room:summary"],
        message_type="decision.response",
        payload=response.model_dump(),
    )
    await handler.handle(env)
    room.start_review.assert_awaited_once()


@pytest.mark.asyncio
async def test_summary_handler_handles_task_status_update():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    update = TaskStatusUpdate(
        task_id=uuid.uuid4(),
        status="completed",
        progress=1.0,
    )
    env = MessageEnvelope(
        sender="room:office",
        recipients=["room:summary"],
        message_type="task.status_update",
        payload=update.model_dump(),
    )
    await handler.handle(env)
    room.generate_insights.assert_awaited_once()


@pytest.mark.asyncio
async def test_summary_handler_handles_evaluation_result():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    result = HarnessEvaluationResult(
        passed=True,
        evaluator_id=uuid.uuid4(),
        notes="All checks passed",
    )
    env = MessageEnvelope(
        sender="harness:evaluator",
        recipients=["room:summary"],
        message_type="harness.evaluation_result",
        payload=result.model_dump(),
    )
    await handler.handle(env)
    room.generate_insights.assert_awaited_once()


@pytest.mark.asyncio
async def test_summary_handler_ignores_unknown_event():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:summary"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.start_review.assert_not_awaited()
    room.generate_insights.assert_not_awaited()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/rooms/summary/test_event_handler.py -v`
Expected: FAIL — `ImportError: cannot import name 'SummaryEventHandler'`

- [ ] **Step 3: 实现 — 创建 SummaryEventHandler**

创建 `src/cabinet/rooms/summary/event_handler.py`：

```python
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import (
    DecisionResponse,
    HarnessEvaluationResult,
    MessageEnvelope,
    SummaryReviewRequest,
    TaskStatusUpdate,
)

if TYPE_CHECKING:
    from cabinet.rooms.summary.protocol import SummaryRoom

logger = logging.getLogger(__name__)


class SummaryEventHandler:
    def __init__(self, room: SummaryRoom):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="summary",
            produces=["summary.insight"],
            consumes=[
                "decision.response",
                "task.status_update",
                "summary.review_request",
                "harness.evaluation_result",
            ],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        msg_type = envelope.message_type
        if msg_type == "summary.review_request":
            request = SummaryReviewRequest(**envelope.payload)
            from cabinet.rooms.summary.models import ReviewType
            await self._room.start_review(request.project_id, ReviewType(request.review_type))
        elif msg_type == "decision.response":
            response = DecisionResponse(**envelope.payload)
            from cabinet.rooms.summary.models import ReviewType
            await self._room.start_review(uuid.UUID(str(response.decision_id)), ReviewType.PROJECT_REVIEW)
        elif msg_type == "task.status_update":
            update = TaskStatusUpdate(**envelope.payload)
            await self._room.generate_insights(update.task_id)
        elif msg_type == "harness.evaluation_result":
            result = HarnessEvaluationResult(**envelope.payload)
            await self._room.generate_insights(result.evaluator_id)
        else:
            logger.warning("SummaryEventHandler received unknown event type: %s", msg_type)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/rooms/summary/test_event_handler.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/rooms/summary/event_handler.py tests/unit/rooms/summary/test_event_handler.py
git commit -m "feat: add SummaryEventHandler with review/insight/evaluation handling"
```

---

### Task 9: 实现 SecretaryEventHandler

**Files:**
- Create: `src/cabinet/rooms/secretary/event_handler.py`
- Create: `tests/unit/rooms/secretary/test_event_handler.py`

- [ ] **Step 1: 写失败测试 — SecretaryEventHandler**

创建 `tests/unit/rooms/secretary/test_event_handler.py`：

```python
import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import EventContract, RoomEventHandler
from cabinet.models.events import DecisionResponse, MessageEnvelope, SummaryInsight
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.protocol import SecretaryAgent


def test_secretary_handler_satisfies_protocol():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_secretary_handler_contract():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)
    contract = handler.contract
    assert contract.room_name == "secretary"
    assert "secretary.notification" in contract.produces
    assert "decision.response" in contract.consumes
    assert "summary.insight" in contract.consumes


@pytest.mark.asyncio
async def test_secretary_handler_handles_decision_response():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    env = MessageEnvelope(
        sender="room:decision",
        recipients=["room:secretary"],
        message_type="decision.response",
        payload=response.model_dump(),
    )
    await handler.handle(env)
    room.notify.assert_awaited_once()


@pytest.mark.asyncio
async def test_secretary_handler_handles_summary_insight():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)

    insight = SummaryInsight(
        insight_type="pattern",
        content="Recurring delay in task completion",
    )
    env = MessageEnvelope(
        sender="room:summary",
        recipients=["room:secretary"],
        message_type="summary.insight",
        payload=insight.model_dump(),
    )
    await handler.handle(env)
    room.notify.assert_awaited_once()


@pytest.mark.asyncio
async def test_secretary_handler_ignores_unknown_event():
    room = AsyncMock(spec=SecretaryAgent)
    handler = SecretaryEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:secretary"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.notify.assert_not_awaited()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest tests/unit/rooms/secretary/test_event_handler.py -v`
Expected: FAIL — `ImportError: cannot import name 'SecretaryEventHandler'`

- [ ] **Step 3: 实现 — 创建 SecretaryEventHandler**

创建 `src/cabinet/rooms/secretary/event_handler.py`：

```python
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import DecisionResponse, MessageEnvelope, SummaryInsight
from cabinet.rooms.secretary.models import NotificationEvent

if TYPE_CHECKING:
    from cabinet.rooms.secretary.protocol import SecretaryAgent

logger = logging.getLogger(__name__)


class SecretaryEventHandler:
    def __init__(self, room: SecretaryAgent):
        self._room = room

    @property
    def contract(self) -> EventContract:
        return EventContract(
            room_name="secretary",
            produces=["secretary.notification"],
            consumes=["decision.response", "summary.insight"],
        )

    async def handle(self, envelope: MessageEnvelope) -> None:
        msg_type = envelope.message_type
        if msg_type == "decision.response":
            response = DecisionResponse(**envelope.payload)
            notification = NotificationEvent(
                event_type="decision_made",
                severity="info",
                source="room:decision",
                content=f"Decision made: {response.chosen_option}",
                related_decision_id=response.decision_id,
            )
            await self._room.notify(notification)
        elif msg_type == "summary.insight":
            insight = SummaryInsight(**envelope.payload)
            severity = "warning" if insight.insight_type == "anomaly" else "info"
            notification = NotificationEvent(
                event_type="insight_generated",
                severity=severity,
                source="room:summary",
                content=insight.content,
            )
            await self._room.notify(notification)
        else:
            logger.warning("SecretaryEventHandler received unknown event type: %s", msg_type)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest tests/unit/rooms/secretary/test_event_handler.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/rooms/secretary/event_handler.py tests/unit/rooms/secretary/test_event_handler.py
git commit -m "feat: add SecretaryEventHandler with decision/insight notification handling"
```

---

### Task 10: 集成测试 — 完整决策链路

**Files:**
- Modify: `tests/integration/test_layer_integration.py`

- [ ] **Step 1: 写集成测试 — 完整决策链路 + 异常链路 + 秘书通知 + 因果链追溯**

在 `tests/integration/test_layer_integration.py` 末尾追加：

```python
import asyncio
import uuid

import pytest

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.models.events import (
    DecisionRequest,
    DecisionResponse,
    DeliberationProposal,
    MessageEnvelope,
    SecretaryNotification,
    SummaryInsight,
    TaskFailure,
    TaskOrder,
    TaskStatusUpdate,
)
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.summary.event_handler import SummaryEventHandler


@pytest.mark.asyncio
async def test_full_decision_pipeline():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    decision_submits = []
    office_tasks = []

    class FakeDecisionRoom:
        async def submit(self, request):
            decision_submits.append(request)

        async def cascade(self, decision):
            pass

    class FakeOfficeRoom:
        async def submit_task(self, order):
            office_tasks.append(order)

    await wiring.register(MeetingEventHandler())
    await wiring.register(DecisionEventHandler(FakeDecisionRoom()))
    await wiring.register(OfficeEventHandler(FakeOfficeRoom()))

    proposal = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    await wiring.publish("meeting", "deliberation.proposal", proposal)

    await asyncio.sleep(0.05)

    assert len(decision_submits) == 1
    assert decision_submits[0].title == "expand market" or decision_submits[0].decision_type is not None


@pytest.mark.asyncio
async def test_decision_to_office_pipeline():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    office_tasks = []

    class FakeOfficeRoom:
        async def submit_task(self, order):
            office_tasks.append(order)

    await wiring.register(OfficeEventHandler(FakeOfficeRoom()))

    order = TaskOrder(
        employee_id=uuid.uuid4(),
        skill_id=uuid.uuid4(),
        inputs={"action": "research"},
    )
    await wiring.publish("decision", "task.order", order)

    await asyncio.sleep(0.05)

    assert len(office_tasks) == 1


@pytest.mark.asyncio
async def test_task_failure_triggers_cascade():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    cascaded = []

    class FakeDecisionRoom:
        async def submit(self, request):
            pass

        async def cascade(self, decision):
            cascaded.append(decision)

    await wiring.register(DecisionEventHandler(FakeDecisionRoom()))

    failure = TaskFailure(
        task_id=uuid.uuid4(),
        error_message="API timeout",
        retry_count=3,
    )
    await wiring.publish("office", "task.failure", failure)

    await asyncio.sleep(0.05)

    assert len(cascaded) == 1
    assert cascaded[0].decision_type.value == "anomaly"


@pytest.mark.asyncio
async def test_secretary_notification_on_decision():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    notifications = []

    class FakeSecretaryRoom:
        async def notify(self, event):
            notifications.append(event)

    await wiring.register(SecretaryEventHandler(FakeSecretaryRoom()))

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    await wiring.publish("decision", "decision.response", response)

    await asyncio.sleep(0.05)

    assert len(notifications) == 1
    assert notifications[0].event_type == "decision_made"


@pytest.mark.asyncio
async def test_causation_chain_across_rooms_with_wiring():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    await wiring.register(MeetingEventHandler())

    proposal = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    await wiring.publish("meeting", "deliberation.proposal", proposal)
    proposal_envelope = bus._store.get_by_type("deliberation.proposal")[0]

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    await wiring.publish("decision", "decision.response", response, causation_id=proposal_envelope.message_id)
    response_envelope = bus._store.get_by_type("decision.response")[0]

    chain = await bus.get_causation_chain(response_envelope.message_id)
    assert len(chain) == 2
    assert chain[0].message_type == "deliberation.proposal"
    assert chain[1].message_type == "decision.response"


@pytest.mark.asyncio
async def test_resolve_recipients_across_all_rooms():
    bus = AsyncIOEventBus()
    wiring = RoomEventWiring(bus)

    class FakeDecisionRoom:
        async def submit(self, request): pass
        async def cascade(self, decision): pass

    class FakeOfficeRoom:
        async def submit_task(self, order): pass

    class FakeSummaryRoom:
        async def start_review(self, project_id, review_type): pass
        async def generate_insights(self, session_id): pass

    class FakeSecretaryRoom:
        async def notify(self, event): pass

    await wiring.register(MeetingEventHandler())
    await wiring.register(DecisionEventHandler(FakeDecisionRoom()))
    await wiring.register(OfficeEventHandler(FakeOfficeRoom()))
    await wiring.register(SummaryEventHandler(FakeSummaryRoom()))
    await wiring.register(SecretaryEventHandler(FakeSecretaryRoom()))

    recipients = wiring.resolve_recipients("deliberation.proposal")
    assert "room:decision" in recipients

    recipients = wiring.resolve_recipients("decision.response")
    assert "room:office" in recipients
    assert "room:summary" in recipients
    assert "room:secretary" in recipients

    recipients = wiring.resolve_recipients("task.order")
    assert "room:office" in recipients

    recipients = wiring.resolve_recipients("task.failure")
    assert "room:decision" in recipients

    recipients = wiring.resolve_recipients("summary.insight")
    assert "room:secretary" in recipients
```

- [ ] **Step 2: 运行集成测试确认通过**

Run: `pytest tests/integration/test_layer_integration.py -v -k "decision_pipeline or task_failure or secretary_notification or causation_chain_with_wiring or resolve_recipients_across"`
Expected: PASS

- [ ] **Step 3: 运行全量测试确认无回归**

Run: `pytest tests/ -v`
Expected: 209+ passed, 0 failed

- [ ] **Step 4: 提交**

```bash
git add tests/integration/test_layer_integration.py
git commit -m "feat: add cross-room event integration tests"
```

---

### Task 11: 契约测试 — 验证 EventContract 与 MessageType 一致性

**Files:**
- Create: `tests/unit/core/events/test_event_contracts.py`

- [ ] **Step 1: 写契约测试 — 验证所有 EventHandler 的 EventContract 与 MessageType 枚举对齐**

创建 `tests/unit/core/events/test_event_contracts.py`：

```python
from cabinet.core.events.wiring import EventContract
from cabinet.models.events import MessageType
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.summary.event_handler import SummaryEventHandler


_ALL_CONTRACTS: list[EventContract] = []


def _collect_contracts():
    from unittest.mock import AsyncMock
    from cabinet.rooms.decision.protocol import DecisionRoom
    from cabinet.rooms.office.protocol import OfficeScheduler
    from cabinet.rooms.summary.protocol import SummaryRoom
    from cabinet.rooms.secretary.protocol import SecretaryAgent

    _ALL_CONTRACTS.append(MeetingEventHandler().contract)
    _ALL_CONTRACTS.append(StrategyEventHandler().contract)
    _ALL_CONTRACTS.append(DecisionEventHandler(AsyncMock(spec=DecisionRoom)).contract)
    _ALL_CONTRACTS.append(OfficeEventHandler(AsyncMock(spec=OfficeScheduler)).contract)
    _ALL_CONTRACTS.append(SummaryEventHandler(AsyncMock(spec=SummaryRoom)).contract)
    _ALL_CONTRACTS.append(SecretaryEventHandler(AsyncMock(spec=SecretaryAgent)).contract)


_collect_contracts()


def test_all_produced_events_have_message_type():
    valid_types = {mt.value for mt in MessageType}
    for contract in _ALL_CONTRACTS:
        for produced in contract.produces:
            assert produced in valid_types, (
                f"Room '{contract.room_name}' produces '{produced}' which is not in MessageType enum"
            )


def test_all_consumed_events_have_message_type():
    valid_types = {mt.value for mt in MessageType}
    for contract in _ALL_CONTRACTS:
        for consumed in contract.consumes:
            assert consumed in valid_types, (
                f"Room '{contract.room_name}' consumes '{consumed}' which is not in MessageType enum"
            )


def test_every_consumed_event_has_producer():
    all_produced = set()
    for contract in _ALL_CONTRACTS:
        all_produced.update(contract.produces)

    for contract in _ALL_CONTRACTS:
        for consumed in contract.consumes:
            assert consumed in all_produced, (
                f"Room '{contract.room_name}' consumes '{consumed}' but no room produces it"
            )


def test_room_names_are_unique():
    names = [c.room_name for c in _ALL_CONTRACTS]
    assert len(names) == len(set(names)), f"Duplicate room names: {names}"


def test_six_rooms_registered():
    assert len(_ALL_CONTRACTS) == 6
```

- [ ] **Step 2: 运行契约测试确认通过**

Run: `pytest tests/unit/core/events/test_event_contracts.py -v`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/unit/core/events/test_event_contracts.py
git commit -m "feat: add event contract validation tests"
```

---

### Task 12: 最终验证

- [ ] **Step 1: 运行全量测试**

Run: `pytest tests/ -v`
Expected: ALL PASSED, 0 failed

- [ ] **Step 2: 运行 ruff lint**

Run: `ruff check src/ tests/`
Expected: 0 errors

- [ ] **Step 3: 验证所有协议可导入**

Run: `python -c "from cabinet.core.events.wiring import EventContract, RoomEventHandler, RoomEventPublisher, RoomEventWiring; print('All imports OK')"`
Expected: `All imports OK`

- [ ] **Step 4: 验证所有 EventHandler 可导入**

Run: `python -c "from cabinet.rooms.meeting.event_handler import MeetingEventHandler; from cabinet.rooms.strategy.event_handler import StrategyEventHandler; from cabinet.rooms.decision.event_handler import DecisionEventHandler; from cabinet.rooms.office.event_handler import OfficeEventHandler; from cabinet.rooms.summary.event_handler import SummaryEventHandler; from cabinet.rooms.secretary.event_handler import SecretaryEventHandler; print('All handlers OK')"`
Expected: `All handlers OK`

- [ ] **Step 5: 提交最终状态**

```bash
git add -A
git commit -m "chore: final verification for cross-room event integration"
```
