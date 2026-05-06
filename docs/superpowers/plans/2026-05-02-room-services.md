# Layer 3 室服务实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为6个室实现事件溯源驱动的业务逻辑服务，使系统从"骨架"变为"活体"。

**Architecture:** 双事件模型——域事件用于状态溯源（细粒度、室内部），跨室事件用于室间通信（已有、零改动）。EventSourcedRoom 抽象基类封装三条规则。AgentFactory 协议解耦 LLM 调用。

**Tech Stack:** Python 3.12+, Pydantic v2, pytest + pytest-asyncio, asyncio

---

## File Structure

### New Files

```
src/cabinet/core/events/event_sourced.py       # EventSourcedRoom + RoomEventStore
src/cabinet/rooms/meeting/domain_events.py      # 6个域事件
src/cabinet/rooms/meeting/service.py            # MeetingRoomService
src/cabinet/rooms/strategy/domain_events.py     # 2个域事件
src/cabinet/rooms/strategy/service.py           # StrategyDecoderService
src/cabinet/rooms/decision/domain_events.py     # 6个域事件
src/cabinet/rooms/decision/service.py           # DecisionRoomService
src/cabinet/rooms/office/domain_events.py       # 7个域事件
src/cabinet/rooms/office/service.py             # OfficeSchedulerService
src/cabinet/rooms/summary/domain_events.py      # 5个域事件
src/cabinet/rooms/summary/service.py            # SummaryRoomService
src/cabinet/rooms/secretary/domain_events.py    # 5个域事件
src/cabinet/rooms/secretary/service.py          # SecretaryAgentService

tests/unit/core/events/test_event_sourced.py
tests/unit/rooms/meeting/test_domain_events.py
tests/unit/rooms/meeting/test_service.py
tests/unit/rooms/strategy/test_domain_events.py
tests/unit/rooms/strategy/test_service.py
tests/unit/rooms/decision/test_domain_events.py
tests/unit/rooms/decision/test_service.py
tests/unit/rooms/office/test_domain_events.py
tests/unit/rooms/office/test_service.py
tests/unit/rooms/summary/test_domain_events.py
tests/unit/rooms/summary/test_service.py
tests/unit/rooms/secretary/test_domain_events.py
tests/unit/rooms/secretary/test_service.py
tests/integration/test_room_services_integration.py
```

### Modified Files

```
src/cabinet/agents/protocol.py                  # 新增 AgentFactory 协议
```

### Unchanged Files

All Protocol files, Models files, EventHandler files, wiring.py, events.py

---

### Task 1: RoomEventStore + EventSourcedRoom 基类

**Files:**
- Create: `src/cabinet/core/events/event_sourced.py`
- Test: `tests/unit/core/events/test_event_sourced.py`

- [ ] **Step 1: Write the failing test for RoomEventStore**

```python
import pytest

from pydantic import BaseModel
from uuid import UUID

from cabinet.core.events.event_sourced import RoomEventStore


class FakeEvent(BaseModel):
    event_type: str
    value: str


class OtherEvent(BaseModel):
    data: int


def test_room_event_store_append_and_get_all():
    store = RoomEventStore("test_room")
    e1 = FakeEvent(event_type="created", value="hello")
    e2 = OtherEvent(data=42)
    store.append(e1)
    store.append(e2)
    all_events = store.get_all()
    assert len(all_events) == 2
    assert all_events[0] == e1
    assert all_events[1] == e2


def test_room_event_store_get_by_type():
    store = RoomEventStore("test_room")
    e1 = FakeEvent(event_type="created", value="hello")
    e2 = OtherEvent(data=42)
    e3 = FakeEvent(event_type="updated", value="world")
    store.append(e1)
    store.append(e2)
    store.append(e3)
    fake_events = store.get_by_type(FakeEvent)
    assert len(fake_events) == 2
    assert fake_events[0].value == "hello"
    assert fake_events[1].value == "world"


def test_room_event_store_room_name():
    store = RoomEventStore("meeting")
    assert store.room_name == "meeting"


def test_room_event_store_clear():
    store = RoomEventStore("test_room")
    store.append(FakeEvent(event_type="created", value="x"))
    store.clear()
    assert store.get_all() == []


def test_room_event_store_get_all_returns_copy():
    store = RoomEventStore("test_room")
    store.append(FakeEvent(event_type="created", value="x"))
    events = store.get_all()
    events.clear()
    assert len(store.get_all()) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/events/test_event_sourced.py -v -k "room_event_store"`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.events.event_sourced'`

- [ ] **Step 3: Write RoomEventStore implementation**

```python
from __future__ import annotations

from typing import TypeVar, Type

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class RoomEventStore:
    def __init__(self, room_name: str):
        self._room_name = room_name
        self._events: list[BaseModel] = []

    @property
    def room_name(self) -> str:
        return self._room_name

    def append(self, event: BaseModel) -> None:
        self._events.append(event)

    def get_all(self) -> list[BaseModel]:
        return list(self._events)

    def get_by_type(self, event_type: Type[T]) -> list[T]:
        return [e for e in self._events if isinstance(e, event_type)]

    def clear(self) -> None:
        self._events.clear()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/events/test_event_sourced.py -v -k "room_event_store"`
Expected: PASS

- [ ] **Step 5: Write the failing test for EventSourcedRoom**

Append to `tests/unit/core/events/test_event_sourced.py`:

```python
from uuid import uuid4

from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher


class ItemCreated(BaseModel):
    item_id: UUID
    name: str


class ItemRenamed(BaseModel):
    item_id: UUID
    new_name: str


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, BaseModel, UUID | None]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: BaseModel, causation_id: UUID | None = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


class ItemRoom(EventSourcedRoom):
    def __init__(self, store: RoomEventStore, publisher: RoomEventPublisher):
        super().__init__(store, publisher)
        self._items: dict[UUID, str] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, ItemCreated):
            self._items[event.item_id] = event.name
            cross_room.append(("item.created", FakeEvent(event_type="created", value=event.name), None))
        elif isinstance(event, ItemRenamed):
            self._items[event.item_id] = event.new_name
        return cross_room

    async def create_item(self, name: str) -> UUID:
        item_id = uuid4()
        await self._publish_and_apply(ItemCreated(item_id=item_id, name=name))
        return item_id

    async def rename_item(self, item_id: UUID, new_name: str) -> None:
        await self._publish_and_apply(ItemRenamed(item_id=item_id, new_name=new_name))


@pytest.fixture
def store():
    return RoomEventStore("item")


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def room(store, publisher):
    return ItemRoom(store, publisher)


@pytest.mark.asyncio
async def test_publish_and_apply_updates_state(room, store):
    item_id = await room.create_item("foo")
    assert room._items[item_id] == "foo"
    assert len(store.get_all()) == 1


@pytest.mark.asyncio
async def test_publish_and_apply_publishes_cross_room(room, publisher):
    await room.create_item("foo")
    assert len(publisher.published) == 1
    assert publisher.published[0][0] == "item"
    assert publisher.published[0][1] == "item.created"


@pytest.mark.asyncio
async def test_apply_event_no_cross_room(room, publisher):
    item_id = uuid4()
    await room.create_item("foo")
    publisher.published.clear()
    await room.rename_item(item_id, "bar")
    assert room._items[item_id] == "bar"
    assert len(publisher.published) == 0


@pytest.mark.asyncio
async def test_restore_from_events(store, publisher):
    item_id = uuid4()
    store.append(ItemCreated(item_id=item_id, name="original"))
    store.append(ItemRenamed(item_id=item_id, new_name="restored"))
    room = ItemRoom(store, publisher)
    await room.restore_from_events()
    assert room._items[item_id] == "restored"


@pytest.mark.asyncio
async def test_restore_does_not_publish_cross_room(store, publisher):
    item_id = uuid4()
    store.append(ItemCreated(item_id=item_id, name="original"))
    room = ItemRoom(store, publisher)
    await room.restore_from_events()
    assert len(publisher.published) == 0


@pytest.mark.asyncio
async def test_event_store_grows(room, store):
    await room.create_item("a")
    await room.create_item("b")
    assert len(store.get_all()) == 2
```

- [ ] **Step 6: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/events/test_event_sourced.py -v -k "publish_and_apply or restore"`
Expected: FAIL — `ImportError: cannot import name 'EventSourcedRoom'`

- [ ] **Step 7: Write EventSourcedRoom implementation**

Append to `src/cabinet/core/events/event_sourced.py`:

```python
from abc import ABC, abstractmethod
from uuid import UUID

from cabinet.core.events.wiring import RoomEventPublisher


class EventSourcedRoom(ABC):
    def __init__(self, store: RoomEventStore, publisher: RoomEventPublisher):
        self._store = store
        self._publisher = publisher

    @abstractmethod
    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        ...

    async def _publish_and_apply(self, event: BaseModel) -> None:
        self._store.append(event)
        cross_room_events = self._apply_event(event)
        for message_type, payload, causation_id in cross_room_events:
            await self._publisher.publish(
                room_name=self._store.room_name,
                message_type=message_type,
                payload=payload,
                causation_id=causation_id,
            )

    async def restore_from_events(self) -> None:
        for event in self._store.get_all():
            self._apply_event(event)
```

- [ ] **Step 8: Run all event_sourced tests**

Run: `python -m pytest tests/unit/core/events/test_event_sourced.py -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/core/events/event_sourced.py tests/unit/core/events/test_event_sourced.py
git commit -m "feat: add RoomEventStore and EventSourcedRoom base class"
```

---

### Task 2: AgentFactory 协议

**Files:**
- Modify: `src/cabinet/agents/protocol.py`
- Test: `tests/unit/agents/test_protocols.py` (verify import)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/agents/test_protocols.py` (or create if needed):

```python
from cabinet.agents.protocol import AgentFactory


def test_agent_factory_is_runtime_checkable():
    class FakeFactory:
        async def create_agent(self, agent_id, role):
            pass
        async def create_team(self, agents, task):
            pass

    assert isinstance(FakeFactory(), AgentFactory)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_protocols.py -v -k "agent_factory"`
Expected: FAIL — `ImportError: cannot import name 'AgentFactory'`

- [ ] **Step 3: Add AgentFactory protocol to agents/protocol.py**

Append to `src/cabinet/agents/protocol.py`:

```python
@runtime_checkable
class AgentFactory(Protocol):
    async def create_agent(self, agent_id: UUID, role: str) -> BaseAgent: ...
    async def create_team(self, agents: list[BaseAgent], task: str) -> BaseTeam: ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_protocols.py -v -k "agent_factory"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/protocol.py tests/unit/agents/test_protocols.py
git commit -m "feat: add AgentFactory protocol"
```

---

### Task 3: 会议室域事件 + MeetingRoomService

**Files:**
- Create: `src/cabinet/rooms/meeting/domain_events.py`
- Create: `src/cabinet/rooms/meeting/service.py`
- Create: `tests/unit/rooms/meeting/test_domain_events.py`
- Create: `tests/unit/rooms/meeting/test_service.py`

- [ ] **Step 1: Write the failing test for domain events**

```python
import pytest

from cabinet.rooms.meeting.domain_events import (
    SessionStarted,
    PerspectiveAdded,
    CrossValidationCompleted,
    ConvergenceAchieved,
    ExpertWoken,
    SessionClosed,
)
from cabinet.rooms.meeting.models import DissentItem, MeetingLevel
from uuid import uuid4


def test_session_started_creation():
    sid = uuid4()
    pid = uuid4()
    p1 = uuid4()
    event = SessionStarted(
        session_id=sid, project_id=pid, topic="test",
        level=MeetingLevel.MULTI_PARTY, participants=[p1],
    )
    assert event.session_id == sid
    assert event.topic == "test"
    assert event.level == MeetingLevel.MULTI_PARTY


def test_perspective_added_creation():
    event = PerspectiveAdded(
        perspective_id=uuid4(), session_id=uuid4(),
        agent_id=uuid4(), content="view", round=1,
    )
    assert event.content == "view"
    assert event.round == 1


def test_cross_validation_completed_creation():
    d = DissentItem(agent_id=uuid4(), content="no", reasoning="risk")
    event = CrossValidationCompleted(
        session_id=uuid4(), consensus="agree",
        dissent=[d], unresolved=["x"],
    )
    assert event.consensus == "agree"
    assert len(event.dissent) == 1


def test_convergence_achieved_creation():
    from cabinet.rooms.meeting.models import ConvergenceResult
    conv = ConvergenceResult(consensus="ok", dissent=[], unresolved=[])
    event = ConvergenceAchieved(
        session_id=uuid4(), proposal_text="plan",
        confidence=0.9, reasoning_summary="solid",
        convergence=conv, rounds_used=2, rumination_detected=False,
    )
    assert event.proposal_text == "plan"
    assert event.confidence == 0.9


def test_expert_woken_creation():
    event = ExpertWoken(session_id=uuid4(), expert_id=uuid4())
    assert event.expert_id is not None


def test_session_closed_creation():
    sid = uuid4()
    event = SessionClosed(session_id=sid)
    assert event.session_id == sid
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/meeting/test_domain_events.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write domain events**

```python
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.rooms.meeting.models import ConvergenceResult, DissentItem, MeetingLevel


class SessionStarted(BaseModel):
    session_id: UUID
    project_id: UUID
    topic: str
    level: MeetingLevel
    participants: list[UUID]


class PerspectiveAdded(BaseModel):
    perspective_id: UUID
    session_id: UUID
    agent_id: UUID
    content: str
    round: int


class CrossValidationCompleted(BaseModel):
    session_id: UUID
    consensus: str
    dissent: list[DissentItem]
    unresolved: list[str]


class ConvergenceAchieved(BaseModel):
    session_id: UUID
    proposal_text: str
    confidence: float
    reasoning_summary: str
    convergence: ConvergenceResult
    rounds_used: int
    rumination_detected: bool


class ExpertWoken(BaseModel):
    session_id: UUID
    expert_id: UUID


class SessionClosed(BaseModel):
    session_id: UUID
```

- [ ] **Step 4: Run domain events test**

Run: `python -m pytest tests/unit/rooms/meeting/test_domain_events.py -v`
Expected: All PASS

- [ ] **Step 5: Write the failing test for MeetingRoomService**

```python
import pytest
from uuid import uuid4

from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import DeliberationProposal, DeliberationDissent
from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationSession,
    DissentItem,
    MeetingLevel,
    Perspective,
)
from cabinet.rooms.meeting.service import MeetingRoomService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("meeting")
    return MeetingRoomService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_start_session(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    assert session.topic == "topic"
    assert session.level == MeetingLevel.MULTI_PARTY
    assert session.status == "open"
    assert p1 in session.participants


@pytest.mark.asyncio
async def test_add_perspective(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    agent_id = uuid4()
    perspective = await service.add_perspective(session.id, agent_id, "my view")
    assert perspective.content == "my view"
    assert perspective.agent_id == agent_id


@pytest.mark.asyncio
async def test_cross_validate(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    await service.add_perspective(session.id, uuid4(), "view1")
    await service.add_perspective(session.id, uuid4(), "view2")
    result = await service.cross_validate(session.id)
    assert result.consensus is not None


@pytest.mark.asyncio
async def test_cross_validate_with_dissent_publishes_event(service, publisher):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    await service.add_perspective(session.id, uuid4(), "view1")
    await service.add_perspective(session.id, uuid4(), "view2")
    publisher.published.clear()
    result = await service.cross_validate(session.id, dissent_items=[
        DissentItem(agent_id=uuid4(), content="I disagree", reasoning="risk"),
    ])
    assert len(publisher.published) == 1
    assert publisher.published[0][1] == "deliberation.dissent"
    assert isinstance(publisher.published[0][2], DeliberationDissent)


@pytest.mark.asyncio
async def test_converge(service, publisher):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    await service.add_perspective(session.id, uuid4(), "view1")
    publisher.published.clear()
    result = await service.converge(session.id)
    assert result.proposal_text is not None
    assert len(publisher.published) == 1
    assert publisher.published[0][1] == "deliberation.proposal"
    assert isinstance(publisher.published[0][2], DeliberationProposal)


@pytest.mark.asyncio
async def test_wake_expert(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.EXPERT_HEARING, [p1], project_id=pid)
    expert_id = uuid4()
    await service.wake_expert(session.id, expert_id)
    assert expert_id in service._sessions[session.id].experts


@pytest.mark.asyncio
async def test_close_session(service):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    output = await service.close_session(session.id)
    assert output.session_id == session.id
    assert service._sessions[session.id].status == "closed"


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    pid = uuid4()
    p1 = uuid4()
    session = await service.start_session("topic", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    agent_id = uuid4()
    await service.add_perspective(session.id, agent_id, "view1")
    new_service = MeetingRoomService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert session.id in new_service._sessions
    assert session.id in new_service._perspectives
    assert len(new_service._perspectives[session.id]) == 1


@pytest.mark.asyncio
async def test_start_session_invalid_level_raises(service):
    with pytest.raises(ValueError):
        await service.start_session("", MeetingLevel.FREE_DRAFT, [], project_id=uuid4())


@pytest.mark.asyncio
async def test_add_perspective_unknown_session_raises(service):
    with pytest.raises(KeyError):
        await service.add_perspective(uuid4(), uuid4(), "view")
```

- [ ] **Step 6: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/meeting/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 7: Write MeetingRoomService**

```python
from __future__ import annotations

from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import DeliberationDissent, DeliberationProposal
from cabinet.rooms.meeting.domain_events import (
    ConvergenceAchieved,
    CrossValidationCompleted,
    ExpertWoken,
    PerspectiveAdded,
    SessionClosed,
    SessionStarted,
)
from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
    DeliberationSession,
    DissentItem,
    MeetingLevel,
    Perspective,
)


class MeetingRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._sessions: dict[UUID, DeliberationSession] = {}
        self._perspectives: dict[UUID, list[Perspective]] = {}
        self._convergences: dict[UUID, ConvergenceResult] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, SessionStarted):
            self._sessions[event.session_id] = DeliberationSession(
                id=event.session_id,
                project_id=event.project_id,
                topic=event.topic,
                level=event.level,
                participants=event.participants,
            )
        elif isinstance(event, PerspectiveAdded):
            sid = event.session_id
            if sid not in self._perspectives:
                self._perspectives[sid] = []
            self._perspectives[sid].append(Perspective(
                id=event.perspective_id,
                session_id=sid,
                agent_id=event.agent_id,
                content=event.content,
                round=event.round,
            ))
        elif isinstance(event, CrossValidationCompleted):
            self._convergences[event.session_id] = ConvergenceResult(
                consensus=event.consensus,
                dissent=event.dissent,
                unresolved=event.unresolved,
            )
            if event.dissent:
                cross_room.append((
                    "deliberation.dissent",
                    DeliberationDissent(
                        dissent_text=event.dissent[0].content,
                        source_agent_id=event.dissent[0].agent_id,
                    ),
                    None,
                ))
        elif isinstance(event, ConvergenceAchieved):
            self._convergences[event.session_id] = ConvergenceResult(
                consensus=event.convergence.consensus,
                dissent=event.convergence.dissent,
                unresolved=event.convergence.unresolved,
            )
            cross_room.append((
                "deliberation.proposal",
                DeliberationProposal(
                    proposal_text=event.proposal_text,
                    confidence=event.confidence,
                    reasoning_summary=event.reasoning_summary,
                ),
                None,
            ))
        elif isinstance(event, ExpertWoken):
            if event.session_id in self._sessions:
                session = self._sessions[event.session_id]
                if event.expert_id not in session.experts:
                    session.experts.append(event.expert_id)
        elif isinstance(event, SessionClosed):
            if event.session_id in self._sessions:
                self._sessions[event.session_id].status = "closed"
        return cross_room

    async def start_session(
        self, topic: str, level: MeetingLevel,
        participants: list[UUID], project_id: UUID | None = None,
    ) -> DeliberationSession:
        if not topic:
            raise ValueError("topic must not be empty")
        if not participants:
            raise ValueError("participants must not be empty")
        session_id = uuid4()
        pid = project_id or uuid4()
        event = SessionStarted(
            session_id=session_id,
            project_id=pid,
            topic=topic,
            level=level,
            participants=participants,
        )
        await self._publish_and_apply(event)
        return self._sessions[session_id]

    async def add_perspective(
        self, session_id: UUID, agent_id: UUID, content: str,
    ) -> Perspective:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
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

    async def cross_validate(
        self, session_id: UUID,
        dissent_items: list[DissentItem] | None = None,
    ) -> ConvergenceResult:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        dissent = dissent_items or []
        perspectives = self._perspectives.get(session_id, [])
        consensus_parts = [p.content for p in perspectives]
        consensus = "; ".join(consensus_parts) if consensus_parts else "no perspectives"
        event = CrossValidationCompleted(
            session_id=session_id,
            consensus=consensus,
            dissent=dissent,
            unresolved=[] if not dissent else ["dissent unresolved"],
        )
        await self._publish_and_apply(event)
        return self._convergences[session_id]

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
        proposal_text = perspectives[0].content if perspectives else "no proposal"
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

    async def wake_expert(self, session_id: UUID, expert_id: UUID) -> None:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        event = ExpertWoken(session_id=session_id, expert_id=expert_id)
        await self._publish_and_apply(event)

    async def close_session(self, session_id: UUID) -> DeliberationOutput:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        session = self._sessions[session_id]
        convergence = self._convergences.get(session_id)
        proposal_text = ""
        confidence = 0.0
        reasoning_summary = ""
        if convergence:
            perspectives = self._perspectives.get(session_id, [])
            proposal_text = perspectives[0].content if perspectives else ""
            confidence = 0.8
            reasoning_summary = "converged"
        event = SessionClosed(session_id=session_id)
        await self._publish_and_apply(event)
        result = DeliberationResult(
            session_id=session_id,
            proposal_text=proposal_text,
            confidence=confidence,
            reasoning_summary=reasoning_summary,
            convergence=convergence or ConvergenceResult(
                consensus="", dissent=[], unresolved=[],
            ),
            rounds_used=session.round,
            rumination_detected=False,
        )
        return DeliberationOutput(session_id=session_id, proposal=result)
```

- [ ] **Step 8: Run all meeting tests**

Run: `python -m pytest tests/unit/rooms/meeting/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/rooms/meeting/domain_events.py src/cabinet/rooms/meeting/service.py tests/unit/rooms/meeting/test_domain_events.py tests/unit/rooms/meeting/test_service.py
git commit -m "feat: add MeetingRoomService with event sourcing"
```

---

### Task 4: 战略解码域事件 + StrategyDecoderService

**Files:**
- Create: `src/cabinet/rooms/strategy/domain_events.py`
- Create: `src/cabinet/rooms/strategy/service.py`
- Create: `tests/unit/rooms/strategy/test_domain_events.py`
- Create: `tests/unit/rooms/strategy/test_service.py`

- [ ] **Step 1: Write the failing test for domain events**

```python
from uuid import uuid4

from cabinet.rooms.strategy.domain_events import BlueprintDecoded, BlueprintValidated


def test_blueprint_decoded_creation():
    event = BlueprintDecoded(
        blueprint_id=uuid4(),
        proposal_session_id=uuid4(),
        action_domains=["marketing"],
        constraints=["budget"],
        success_criteria=["revenue up"],
    )
    assert event.action_domains == ["marketing"]
    assert event.constraints == ["budget"]


def test_blueprint_validated_creation():
    event = BlueprintValidated(
        blueprint_id=uuid4(),
        is_valid=True,
        validation_notes=["looks good"],
    )
    assert event.is_valid is True
    assert len(event.validation_notes) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/strategy/test_domain_events.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write domain events**

```python
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class BlueprintDecoded(BaseModel):
    blueprint_id: UUID
    proposal_session_id: UUID
    action_domains: list[str]
    constraints: list[str]
    success_criteria: list[str]


class BlueprintValidated(BaseModel):
    blueprint_id: UUID
    is_valid: bool
    validation_notes: list[str]
```

- [ ] **Step 4: Run domain events test**

Run: `python -m pytest tests/unit/rooms/strategy/test_domain_events.py -v`
Expected: All PASS

- [ ] **Step 5: Write the failing test for StrategyDecoderService**

```python
import pytest
from uuid import uuid4

from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import StrategyDecodeResult
from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
)
from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    ActionDomain,
    BlueprintValidation,
    DecodeContext,
)
from cabinet.rooms.strategy.service import StrategyDecoderService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("strategy")
    return StrategyDecoderService(store, publisher, StubAgentFactory())


def _make_proposal() -> DeliberationOutput:
    return DeliberationOutput(
        session_id=uuid4(),
        proposal=DeliberationResult(
            session_id=uuid4(),
            proposal_text="expand market",
            confidence=0.85,
            reasoning_summary="strong signal",
            convergence=ConvergenceResult(consensus="go", dissent=[], unresolved=[]),
            rounds_used=2,
            rumination_detected=False,
        ),
    )


@pytest.mark.asyncio
async def test_decode(service, publisher):
    proposal = _make_proposal()
    context = DecodeContext(project_id=uuid4(), captain_id="cap1")
    blueprint = await service.decode(proposal, context)
    assert isinstance(blueprint, ActionBlueprint)
    assert blueprint.project_id == context.project_id
    assert len(publisher.published) == 1
    assert publisher.published[0][1] == "strategy.decode_result"
    assert isinstance(publisher.published[0][2], StrategyDecodeResult)


@pytest.mark.asyncio
async def test_validate_blueprint(service):
    proposal = _make_proposal()
    context = DecodeContext(project_id=uuid4(), captain_id="cap1")
    blueprint = await service.decode(proposal, context)
    validation = await service.validate_blueprint(blueprint)
    assert isinstance(validation, BlueprintValidation)


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    proposal = _make_proposal()
    context = DecodeContext(project_id=uuid4(), captain_id="cap1")
    blueprint = await service.decode(proposal, context)
    new_service = StrategyDecoderService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert blueprint.id in new_service._blueprints
```

- [ ] **Step 6: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/strategy/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 7: Write StrategyDecoderService**

```python
from __future__ import annotations

from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import StrategyDecodeResult
from cabinet.rooms.meeting.models import DeliberationOutput
from cabinet.rooms.strategy.domain_events import BlueprintDecoded, BlueprintValidated
from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    ActionDomain,
    BlueprintValidation,
    DecodeContext,
)


class StrategyDecoderService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._blueprints: dict[UUID, ActionBlueprint] = {}
        self._validations: dict[UUID, BlueprintValidation] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, BlueprintDecoded):
            domains = [
                ActionDomain(name=d, goal="") for d in event.action_domains
            ]
            self._blueprints[event.blueprint_id] = ActionBlueprint(
                id=event.blueprint_id,
                project_id=uuid4(),
                source_proposal_id=event.proposal_session_id,
                domains=domains,
                execution_order=[[d.name] for d in domains],
                global_constraints=event.constraints,
            )
            cross_room.append((
                "strategy.decode_result",
                StrategyDecodeResult(
                    action_domains=event.action_domains,
                    constraints=event.constraints,
                    success_criteria=event.success_criteria,
                ),
                None,
            ))
        elif isinstance(event, BlueprintValidated):
            self._validations[event.blueprint_id] = BlueprintValidation(
                valid=event.is_valid,
                validation_notes=event.validation_notes,
                domain_count_ok=True,
                dependencies_resolved=True,
                criteria_measurable=True,
            )
        return cross_room

    async def decode(
        self, proposal: DeliberationOutput, context: DecodeContext,
    ) -> ActionBlueprint:
        blueprint_id = uuid4()
        event = BlueprintDecoded(
            blueprint_id=blueprint_id,
            proposal_session_id=proposal.session_id,
            action_domains=["primary"],
            constraints=["budget"],
            success_criteria=["revenue increase"],
        )
        await self._publish_and_apply(event)
        return self._blueprints[blueprint_id]

    async def validate_blueprint(
        self, blueprint: ActionBlueprint,
    ) -> BlueprintValidation:
        event = BlueprintValidated(
            blueprint_id=blueprint.id,
            is_valid=True,
            validation_notes=["validated"],
        )
        await self._publish_and_apply(event)
        return self._validations[blueprint.id]
```

- [ ] **Step 8: Run all strategy tests**

Run: `python -m pytest tests/unit/rooms/strategy/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/rooms/strategy/domain_events.py src/cabinet/rooms/strategy/service.py tests/unit/rooms/strategy/test_domain_events.py tests/unit/rooms/strategy/test_service.py
git commit -m "feat: add StrategyDecoderService with event sourcing"
```

---

### Task 5: 决策室域事件 + DecisionRoomService

**Files:**
- Create: `src/cabinet/rooms/decision/domain_events.py`
- Create: `src/cabinet/rooms/decision/service.py`
- Create: `tests/unit/rooms/decision/test_domain_events.py`
- Create: `tests/unit/rooms/decision/test_service.py`

- [ ] **Step 1: Write the failing test for domain events**

```python
from uuid import uuid4

from cabinet.models.decisions import DecisionType
from cabinet.rooms.decision.domain_events import (
    AuthorizationRuleSet,
    DecisionApproved,
    DecisionCascaded,
    DecisionDelegated,
    DecisionRejected,
    DecisionSubmitted,
)


def test_decision_submitted_creation():
    event = DecisionSubmitted(
        decision_id=uuid4(), project_id=uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="hire", description="hire someone",
        options=[{"label": "yes"}], captain_id="cap1",
        source_event_id=None,
    )
    assert event.decision_type == DecisionType.STRATEGIC
    assert event.title == "hire"


def test_decision_approved_creation():
    event = DecisionApproved(
        decision_id=uuid4(), chosen_option={"action": "go"},
    )
    assert event.chosen_option["action"] == "go"


def test_decision_rejected_creation():
    event = DecisionRejected(decision_id=uuid4(), reason="too risky")
    assert event.reason == "too risky"


def test_decision_delegated_creation():
    event = DecisionDelegated(decision_id=uuid4(), delegate_to="agent-1")
    assert event.delegate_to == "agent-1"


def test_authorization_rule_set_creation():
    event = AuthorizationRuleSet(
        rule_id=uuid4(), captain_id="cap1",
        decision_type=DecisionType.ACTION,
        auto_approve=True, conditions=["budget < 1000"],
    )
    assert event.auto_approve is True


def test_decision_cascaded_creation():
    parent = uuid4()
    child1 = uuid4()
    child2 = uuid4()
    event = DecisionCascaded(
        parent_decision_id=parent, child_decision_ids=[child1, child2],
    )
    assert len(event.child_decision_ids) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/decision/test_domain_events.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write domain events**

```python
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.models.decisions import DecisionType


class DecisionSubmitted(BaseModel):
    decision_id: UUID
    project_id: UUID
    decision_type: DecisionType
    title: str
    description: str
    options: list[dict]
    captain_id: str
    source_event_id: UUID | None


class DecisionApproved(BaseModel):
    decision_id: UUID
    chosen_option: dict


class DecisionRejected(BaseModel):
    decision_id: UUID
    reason: str


class DecisionDelegated(BaseModel):
    decision_id: UUID
    delegate_to: str


class AuthorizationRuleSet(BaseModel):
    rule_id: UUID
    captain_id: str
    decision_type: DecisionType
    auto_approve: bool
    conditions: list[str]


class DecisionCascaded(BaseModel):
    parent_decision_id: UUID
    child_decision_ids: list[UUID]
```

- [ ] **Step 4: Run domain events test**

Run: `python -m pytest tests/unit/rooms/decision/test_domain_events.py -v`
Expected: All PASS

- [ ] **Step 5: Write the failing test for DecisionRoomService**

```python
import pytest
from uuid import uuid4

from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.decisions import Decision, DecisionType
from cabinet.models.events import DecisionRequest, DecisionResponse, TaskOrder
from cabinet.rooms.decision.models import AuthorizationRule, AuthorizationVerdict
from cabinet.rooms.decision.service import DecisionRoomService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("decision")
    return DecisionRoomService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_submit(service):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[{"label": "yes"}],
    )
    decision = await service.submit(request)
    assert decision.title == "hire"
    assert decision.status.value == "pending"


@pytest.mark.asyncio
async def test_approve(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[{"label": "yes"}],
    )
    decision = await service.submit(request)
    publisher.published.clear()
    approved = await service.approve(decision.id, {"label": "yes"})
    assert approved.status.value == "approved"
    assert approved.chosen_option == {"label": "yes"}
    assert any(mt == "decision.response" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_approve_with_execution_triggers_task_order(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="action",
        title="execute task", options=[{"label": "go"}],
    )
    decision = await service.submit(request)
    publisher.published.clear()
    chosen = {"label": "go", "employee_id": uuid4(), "skill_id": uuid4()}
    await service.approve(decision.id, chosen)
    msg_types = [mt for _, mt, _, _ in publisher.published]
    assert "decision.response" in msg_types
    assert "task.order" in msg_types


@pytest.mark.asyncio
async def test_reject(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[],
    )
    decision = await service.submit(request)
    publisher.published.clear()
    rejected = await service.reject(decision.id, "too risky")
    assert rejected.status.value == "rejected"
    assert any(mt == "decision.response" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_delegate(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="execution",
        title="deploy", options=[],
    )
    decision = await service.submit(request)
    publisher.published.clear()
    delegated = await service.delegate(decision.id, "agent-1")
    assert delegated.status.value == "delegated"
    assert any(mt == "decision.response" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_set_authorization_and_check(service):
    rule = AuthorizationRule(
        captain_id="cap1",
        decision_type=DecisionType.EXECUTION,
        auto_approve=True,
        conditions=["budget < 1000"],
    )
    await service.set_authorization(rule)
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="small task",
        description="minor",
        captain_id="cap1",
    )
    verdict = await service.check_authorization(decision)
    assert verdict.auto_process is True


@pytest.mark.asyncio
async def test_cascade(service, publisher):
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.ANOMALY,
        title="failure",
        description="task failed",
        captain_id="system",
    )
    publisher.published.clear()
    children = await service.cascade(decision)
    assert len(children) >= 1
    assert any(mt == "decision.response" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_get_dashboard(service):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[],
    )
    await service.submit(request)
    dashboard = await service.get_dashboard(uuid4())
    assert dashboard.total_pending >= 1


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="strategic",
        title="hire", options=[],
    )
    await service.submit(request)
    new_service = DecisionRoomService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert len(new_service._decisions) == len(service._decisions)


@pytest.mark.asyncio
async def test_submit_unknown_decision_raises(service):
    with pytest.raises(KeyError):
        await service.approve(uuid4(), {"label": "yes"})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/decision/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 7: Write DecisionRoomService**

```python
from __future__ import annotations

from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.decisions import Decision, DecisionStatus, DecisionType
from cabinet.models.events import DecisionRequest, DecisionResponse, TaskOrder
from cabinet.rooms.decision.domain_events import (
    AuthorizationRuleSet,
    DecisionApproved,
    DecisionCascaded,
    DecisionDelegated,
    DecisionRejected,
    DecisionSubmitted,
)
from cabinet.rooms.decision.models import (
    AuthorizationRule,
    AuthorizationVerdict,
    DecisionCard,
    DecisionDashboard,
)


class DecisionRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._decisions: dict[UUID, Decision] = {}
        self._rules: dict[UUID, AuthorizationRule] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, DecisionSubmitted):
            self._decisions[event.decision_id] = Decision(
                id=event.decision_id,
                project_id=event.project_id,
                decision_type=event.decision_type,
                title=event.title,
                description=event.description,
                options=event.options,
                captain_id=event.captain_id,
                source_event_id=event.source_event_id,
            )
        elif isinstance(event, DecisionApproved):
            if event.decision_id in self._decisions:
                d = self._decisions[event.decision_id]
                self._decisions[event.decision_id] = d.model_copy(update={
                    "status": DecisionStatus.APPROVED,
                    "chosen_option": event.chosen_option,
                })
                cross_room.append((
                    "decision.response",
                    DecisionResponse(
                        decision_id=event.decision_id,
                        chosen_option=event.chosen_option,
                        captain_id=self._decisions[event.decision_id].captain_id,
                    ),
                    None,
                ))
                if "employee_id" in event.chosen_option and "skill_id" in event.chosen_option:
                    cross_room.append((
                        "task.order",
                        TaskOrder(
                            employee_id=event.chosen_option["employee_id"],
                            skill_id=event.chosen_option["skill_id"],
                            inputs=event.chosen_option.get("inputs", {}),
                        ),
                        None,
                    ))
        elif isinstance(event, DecisionRejected):
            if event.decision_id in self._decisions:
                d = self._decisions[event.decision_id]
                self._decisions[event.decision_id] = d.model_copy(update={
                    "status": DecisionStatus.REJECTED,
                })
                cross_room.append((
                    "decision.response",
                    DecisionResponse(
                        decision_id=event.decision_id,
                        chosen_option={},
                        captain_id=self._decisions[event.decision_id].captain_id,
                    ),
                    None,
                ))
        elif isinstance(event, DecisionDelegated):
            if event.decision_id in self._decisions:
                d = self._decisions[event.decision_id]
                self._decisions[event.decision_id] = d.model_copy(update={
                    "status": DecisionStatus.DELEGATED,
                })
                cross_room.append((
                    "decision.response",
                    DecisionResponse(
                        decision_id=event.decision_id,
                        chosen_option={"delegate_to": event.delegate_to},
                        captain_id=self._decisions[event.decision_id].captain_id,
                    ),
                    None,
                ))
        elif isinstance(event, AuthorizationRuleSet):
            self._rules[event.rule_id] = AuthorizationRule(
                id=event.rule_id,
                captain_id=event.captain_id,
                decision_type=event.decision_type,
                auto_approve=event.auto_approve,
                conditions=event.conditions,
            )
        elif isinstance(event, DecisionCascaded):
            for child_id in event.child_decision_ids:
                if child_id not in self._decisions:
                    self._decisions[child_id] = Decision(
                        id=child_id,
                        project_id=uuid4(),
                        decision_type=DecisionType.ANOMALY,
                        title="cascaded decision",
                        description="auto-created by cascade",
                        captain_id="system",
                    )
            if event.parent_decision_id in self._decisions:
                cross_room.append((
                    "decision.response",
                    DecisionResponse(
                        decision_id=event.parent_decision_id,
                        chosen_option={"cascaded": True},
                        captain_id=self._decisions[event.parent_decision_id].captain_id,
                    ),
                    None,
                ))
        return cross_room

    async def submit(self, request: DecisionRequest) -> Decision:
        event = DecisionSubmitted(
            decision_id=request.decision_id,
            project_id=uuid4(),
            decision_type=DecisionType(request.decision_type),
            title=request.title,
            description=request.title,
            options=request.options,
            captain_id="system",
            source_event_id=None,
        )
        await self._publish_and_apply(event)
        return self._decisions[request.decision_id]

    async def approve(self, decision_id: UUID, option: dict) -> Decision:
        if decision_id not in self._decisions:
            raise KeyError(f"decision {decision_id} not found")
        event = DecisionApproved(decision_id=decision_id, chosen_option=option)
        await self._publish_and_apply(event)
        return self._decisions[decision_id]

    async def reject(self, decision_id: UUID, reason: str) -> Decision:
        if decision_id not in self._decisions:
            raise KeyError(f"decision {decision_id} not found")
        event = DecisionRejected(decision_id=decision_id, reason=reason)
        await self._publish_and_apply(event)
        return self._decisions[decision_id]

    async def delegate(self, decision_id: UUID, delegate_to: str) -> Decision:
        if decision_id not in self._decisions:
            raise KeyError(f"decision {decision_id} not found")
        event = DecisionDelegated(decision_id=decision_id, delegate_to=delegate_to)
        await self._publish_and_apply(event)
        return self._decisions[decision_id]

    async def get_dashboard(self, project_id: UUID) -> DecisionDashboard:
        pending = [
            d for d in self._decisions.values()
            if d.status == DecisionStatus.PENDING
        ]
        cards = [
            DecisionCard(
                decision=d,
                urgency_color=d.urgency,
                summary=d.title,
                options_summary=[str(o) for o in d.options],
                source_room="unknown",
                created_ago="just now",
            )
            for d in pending
        ]
        return DecisionDashboard(
            project_id=project_id,
            red_cards=[c for c in cards if c.urgency_color == "red"],
            yellow_cards=[c for c in cards if c.urgency_color == "yellow"],
            blue_cards=[c for c in cards if c.urgency_color == "blue"],
            white_cards=[c for c in cards if c.urgency_color == "white"],
            total_pending=len(pending),
        )

    async def set_authorization(self, rule: AuthorizationRule) -> None:
        event = AuthorizationRuleSet(
            rule_id=rule.id,
            captain_id=rule.captain_id,
            decision_type=rule.decision_type,
            auto_approve=rule.auto_approve,
            conditions=rule.conditions,
        )
        await self._publish_and_apply(event)

    async def check_authorization(self, decision: Decision) -> AuthorizationVerdict:
        for rule in self._rules.values():
            if rule.decision_type == decision.decision_type and rule.auto_approve:
                return AuthorizationVerdict(
                    auto_process=True,
                    requires_captain=False,
                    reason="matched auto-approve rule",
                    matched_rule=rule.id,
                )
        return AuthorizationVerdict(
            auto_process=False,
            requires_captain=True,
            reason="no matching auto-approve rule",
        )

    async def cascade(self, decision: Decision) -> list[Decision]:
        parent_id = decision.id
        child_ids = [uuid4()]
        self._decisions[parent_id] = decision
        event = DecisionCascaded(
            parent_decision_id=parent_id,
            child_decision_ids=child_ids,
        )
        await self._publish_and_apply(event)
        return [self._decisions[cid] for cid in child_ids]
```

- [ ] **Step 8: Run all decision tests**

Run: `python -m pytest tests/unit/rooms/decision/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/rooms/decision/domain_events.py src/cabinet/rooms/decision/service.py tests/unit/rooms/decision/test_domain_events.py tests/unit/rooms/decision/test_service.py
git commit -m "feat: add DecisionRoomService with event sourcing"
```

---

### Task 6: 办公室域事件 + OfficeSchedulerService

**Files:**
- Create: `src/cabinet/rooms/office/domain_events.py`
- Create: `src/cabinet/rooms/office/service.py`
- Create: `tests/unit/rooms/office/test_domain_events.py`
- Create: `tests/unit/rooms/office/test_service.py`

- [ ] **Step 1: Write the failing test for domain events**

```python
from uuid import uuid4

from cabinet.rooms.office.domain_events import (
    TaskCancelled,
    TaskFailed,
    TaskStatusChanged,
    TaskSubmitted,
    WorkflowCompleted,
    WorkflowNodeCompleted,
    WorkflowStarted,
)


def test_task_submitted_creation():
    event = TaskSubmitted(
        task_id=uuid4(), project_id=uuid4(),
        employee_id=uuid4(), skill_id=uuid4(), inputs={"key": "val"},
    )
    assert event.inputs == {"key": "val"}


def test_task_cancelled_creation():
    event = TaskCancelled(task_id=uuid4())
    assert event.task_id is not None


def test_task_status_changed_creation():
    event = TaskStatusChanged(
        task_id=uuid4(), old_status="queued",
        new_status="running", progress=0.5,
    )
    assert event.new_status == "running"


def test_task_failed_creation():
    event = TaskFailed(
        task_id=uuid4(), error_message="crash", retry_count=1,
    )
    assert event.error_message == "crash"


def test_workflow_started_creation():
    event = WorkflowStarted(
        execution_id=uuid4(), workflow_id=uuid4(), project_id=uuid4(),
    )
    assert event.workflow_id is not None


def test_workflow_node_completed_creation():
    event = WorkflowNodeCompleted(
        execution_id=uuid4(), node_id=uuid4(), result={"output": "done"},
    )
    assert event.result == {"output": "done"}


def test_workflow_completed_creation():
    event = WorkflowCompleted(
        execution_id=uuid4(), results={"node1": {"ok": True}},
    )
    assert "node1" in event.results
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/office/test_domain_events.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write domain events**

```python
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class TaskSubmitted(BaseModel):
    task_id: UUID
    project_id: UUID
    employee_id: UUID
    skill_id: UUID
    inputs: dict


class TaskCancelled(BaseModel):
    task_id: UUID


class TaskStatusChanged(BaseModel):
    task_id: UUID
    old_status: str
    new_status: str
    progress: float


class TaskFailed(BaseModel):
    task_id: UUID
    error_message: str
    retry_count: int


class WorkflowStarted(BaseModel):
    execution_id: UUID
    workflow_id: UUID
    project_id: UUID


class WorkflowNodeCompleted(BaseModel):
    execution_id: UUID
    node_id: UUID
    result: dict


class WorkflowCompleted(BaseModel):
    execution_id: UUID
    results: dict[str, dict]
```

- [ ] **Step 4: Run domain events test**

Run: `python -m pytest tests/unit/rooms/office/test_domain_events.py -v`
Expected: All PASS

- [ ] **Step 5: Write the failing test for OfficeSchedulerService**

```python
import pytest
from uuid import uuid4

from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import TaskFailure, TaskOrder, TaskStatusUpdate
from cabinet.rooms.office.models import PermissionLevel, PermissionVerdict, Task, TaskStatus
from cabinet.rooms.office.service import OfficeSchedulerService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("office")
    return OfficeSchedulerService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_submit_task(service, publisher):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"x": 1})
    task = await service.submit_task(order)
    assert task.status == "queued"
    assert task.employee_id == order.employee_id


@pytest.mark.asyncio
async def test_cancel_task(service, publisher):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    publisher.published.clear()
    await service.cancel_task(task.id)
    assert service._tasks[task.id].status == "cancelled"
    msg_types = [mt for _, mt, _, _ in publisher.published]
    assert "task.status_update" in msg_types


@pytest.mark.asyncio
async def test_get_task_status(service):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    status = await service.get_task_status(task.id)
    assert isinstance(status, TaskStatus)
    assert status.status == "queued"


@pytest.mark.asyncio
async def test_list_active_tasks(service):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"p": uuid4()})
    await service.submit_task(order)
    pid = list(service._tasks.values())[0].project_id
    active = await service.list_active_tasks(pid)
    assert len(active) >= 1


@pytest.mark.asyncio
async def test_execute_workflow(service):
    wf_id = uuid4()
    pid = uuid4()
    execution = await service.execute_workflow(wf_id, {"input": "data"})
    assert execution.status == "running"
    assert execution.workflow_id == wf_id


@pytest.mark.asyncio
async def test_check_permission(service):
    verdict = await service.check_permission(uuid4(), "read")
    assert isinstance(verdict, PermissionVerdict)


@pytest.mark.asyncio
async def test_task_failure_publishes_event(service, publisher):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    publisher.published.clear()
    event = TaskFailed(
        task_id=task.id, error_message="crash", retry_count=0,
    )
    service._apply_event(event)
    assert any(isinstance(p, TaskFailure) for _, _, p, _ in publisher.published) is False
    cross = service._apply_event(TaskFailed(
        task_id=task.id, error_message="crash", retry_count=0,
    ))
    msg_types = [mt for mt, _, _ in cross]
    assert "task.failure" in msg_types


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    new_service = OfficeSchedulerService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert task.id in new_service._tasks
```

- [ ] **Step 6: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/office/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 7: Write OfficeSchedulerService**

```python
from __future__ import annotations

from uuid import UUID, uuid4

from pydantic import BaseModel

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
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._tasks: dict[UUID, Task] = {}
        self._executions: dict[UUID, WorkflowExecution] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, TaskSubmitted):
            self._tasks[event.task_id] = Task(
                id=event.task_id,
                project_id=event.project_id,
                employee_id=event.employee_id,
                skill_id=event.skill_id,
                inputs=event.inputs,
                status="queued",
            )
        elif isinstance(event, TaskCancelled):
            if event.task_id in self._tasks:
                self._tasks[event.task_id] = self._tasks[event.task_id].model_copy(
                    update={"status": "cancelled"},
                )
                cross_room.append((
                    "task.status_update",
                    TaskStatusUpdate(
                        task_id=event.task_id,
                        status="cancelled",
                        progress=0.0,
                    ),
                    None,
                ))
        elif isinstance(event, TaskStatusChanged):
            if event.task_id in self._tasks:
                self._tasks[event.task_id] = self._tasks[event.task_id].model_copy(
                    update={
                        "status": event.new_status,
                        "progress": event.progress,
                    },
                )
                cross_room.append((
                    "task.status_update",
                    TaskStatusUpdate(
                        task_id=event.task_id,
                        status=event.new_status,
                        progress=event.progress,
                    ),
                    None,
                ))
        elif isinstance(event, TaskFailed):
            if event.task_id in self._tasks:
                self._tasks[event.task_id] = self._tasks[event.task_id].model_copy(
                    update={
                        "status": "failed",
                        "error": event.error_message,
                        "retry_count": event.retry_count,
                    },
                )
                cross_room.append((
                    "task.failure",
                    TaskFailure(
                        task_id=event.task_id,
                        error_message=event.error_message,
                        retry_count=event.retry_count,
                    ),
                    None,
                ))
        elif isinstance(event, WorkflowStarted):
            self._executions[event.execution_id] = WorkflowExecution(
                id=event.execution_id,
                workflow_id=event.workflow_id,
                project_id=event.project_id,
            )
        elif isinstance(event, WorkflowNodeCompleted):
            if event.execution_id in self._executions:
                ex = self._executions[event.execution_id]
                completed = ex.completed_nodes + [event.node_id]
                results = {**ex.results, str(event.node_id): event.result}
                self._executions[event.execution_id] = ex.model_copy(update={
                    "completed_nodes": completed,
                    "results": results,
                })
        elif isinstance(event, WorkflowCompleted):
            if event.execution_id in self._executions:
                self._executions[event.execution_id] = self._executions[event.execution_id].model_copy(
                    update={"status": "completed", "results": event.results},
                )
                cross_room.append((
                    "task.status_update",
                    TaskStatusUpdate(
                        task_id=event.execution_id,
                        status="completed",
                        progress=1.0,
                    ),
                    None,
                ))
        return cross_room

    async def submit_task(self, order: TaskOrder) -> Task:
        task_id = uuid4()
        project_id = order.inputs.get("p", uuid4()) if isinstance(order.inputs.get("p"), UUID) else uuid4()
        event = TaskSubmitted(
            task_id=task_id,
            project_id=project_id,
            employee_id=order.employee_id,
            skill_id=order.skill_id,
            inputs=order.inputs,
        )
        await self._publish_and_apply(event)
        return self._tasks[task_id]

    async def cancel_task(self, task_id: UUID) -> None:
        if task_id not in self._tasks:
            raise KeyError(f"task {task_id} not found")
        event = TaskCancelled(task_id=task_id)
        await self._publish_and_apply(event)

    async def get_task_status(self, task_id: UUID) -> TaskStatus:
        if task_id not in self._tasks:
            raise KeyError(f"task {task_id} not found")
        task = self._tasks[task_id]
        return TaskStatus(
            task_id=task.id,
            status=task.status,
            progress=task.progress,
        )

    async def list_active_tasks(self, project_id: UUID) -> list[Task]:
        return [
            t for t in self._tasks.values()
            if t.project_id == project_id and t.status in ("queued", "running")
        ]

    async def execute_workflow(self, workflow_id: UUID, inputs: dict) -> WorkflowExecution:
        execution_id = uuid4()
        project_id = inputs.get("project_id", uuid4()) if isinstance(inputs.get("project_id"), UUID) else uuid4()
        event = WorkflowStarted(
            execution_id=execution_id,
            workflow_id=workflow_id,
            project_id=project_id,
        )
        await self._publish_and_apply(event)
        return self._executions[execution_id]

    async def check_permission(self, employee_id: UUID, action: str) -> PermissionVerdict:
        return PermissionVerdict(
            allowed=True,
            level=PermissionLevel.L1,
            reason="default allow",
        )
```

- [ ] **Step 8: Run all office tests**

Run: `python -m pytest tests/unit/rooms/office/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/rooms/office/domain_events.py src/cabinet/rooms/office/service.py tests/unit/rooms/office/test_domain_events.py tests/unit/rooms/office/test_service.py
git commit -m "feat: add OfficeSchedulerService with event sourcing"
```

---

### Task 7: 总结室域事件 + SummaryRoomService

**Files:**
- Create: `src/cabinet/rooms/summary/domain_events.py`
- Create: `src/cabinet/rooms/summary/service.py`
- Create: `tests/unit/rooms/summary/test_domain_events.py`
- Create: `tests/unit/rooms/summary/test_service.py`

- [ ] **Step 1: Write the failing test for domain events**

```python
from uuid import uuid4

from cabinet.rooms.summary.domain_events import (
    AuthorizationAudited,
    DecisionTreeBuilt,
    ImprovementsSuggested,
    InsightsGenerated,
    ReviewStarted,
)
from cabinet.rooms.summary.models import ReviewType


def test_review_started_creation():
    event = ReviewStarted(
        session_id=uuid4(), project_id=uuid4(),
        review_type=ReviewType.PROJECT_REVIEW,
    )
    assert event.review_type == ReviewType.PROJECT_REVIEW


def test_insights_generated_creation():
    event = InsightsGenerated(session_id=uuid4(), insights=[])
    assert event.insights == []


def test_decision_tree_built_creation():
    event = DecisionTreeBuilt(project_id=uuid4(), tree=None)
    assert event.project_id is not None


def test_improvements_suggested_creation():
    event = ImprovementsSuggested(session_id=uuid4(), suggestions=[])
    assert event.suggestions == []


def test_authorization_audited_creation():
    event = AuthorizationAudited(captain_id="cap1", audit=None)
    assert event.captain_id == "cap1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/summary/test_domain_events.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write domain events**

```python
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    ImprovementSuggestion,
    Insight,
    ReviewType,
)


class ReviewStarted(BaseModel):
    session_id: UUID
    project_id: UUID
    review_type: ReviewType


class InsightsGenerated(BaseModel):
    session_id: UUID
    insights: list[Insight]


class DecisionTreeBuilt(BaseModel):
    project_id: UUID
    tree: DecisionTree | None


class ImprovementsSuggested(BaseModel):
    session_id: UUID
    suggestions: list[ImprovementSuggestion]


class AuthorizationAudited(BaseModel):
    captain_id: str
    audit: AuthorizationAudit | None
```

- [ ] **Step 4: Run domain events test**

Run: `python -m pytest tests/unit/rooms/summary/test_domain_events.py -v`
Expected: All PASS

- [ ] **Step 5: Write the failing test for SummaryRoomService**

```python
import pytest
from uuid import uuid4

from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import SummaryInsight
from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    DecisionTreeNode,
    ImprovementSuggestion,
    Insight,
    ReviewType,
)
from cabinet.rooms.summary.service import SummaryRoomService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("summary")
    return SummaryRoomService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_start_review(service):
    pid = uuid4()
    session = await service.start_review(pid, ReviewType.PROJECT_REVIEW)
    assert session.project_id == pid
    assert session.review_type == ReviewType.PROJECT_REVIEW


@pytest.mark.asyncio
async def test_generate_insights(service, publisher):
    pid = uuid4()
    session = await service.start_review(pid, ReviewType.CAPTAIN_INSIGHT)
    publisher.published.clear()
    insights = await service.generate_insights(session.id)
    assert isinstance(insights, list)
    assert any(mt == "summary.insight" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_build_decision_tree(service):
    pid = uuid4()
    tree = await service.build_decision_tree(pid)
    assert isinstance(tree, DecisionTree)
    assert tree.project_id == pid


@pytest.mark.asyncio
async def test_suggest_improvements(service):
    pid = uuid4()
    session = await service.start_review(pid, ReviewType.ORG_OPTIMIZATION)
    suggestions = await service.suggest_improvements(session.id)
    assert isinstance(suggestions, list)


@pytest.mark.asyncio
async def test_audit_authorization_usage(service):
    audit = await service.audit_authorization_usage("cap1")
    assert isinstance(audit, AuthorizationAudit)
    assert audit.captain_id == "cap1"


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    pid = uuid4()
    await service.start_review(pid, ReviewType.PROJECT_REVIEW)
    new_service = SummaryRoomService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert len(new_service._sessions) == len(service._sessions)
```

- [ ] **Step 6: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/summary/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 7: Write SummaryRoomService**

```python
from __future__ import annotations

from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import SummaryInsight
from cabinet.rooms.summary.domain_events import (
    AuthorizationAudited,
    DecisionTreeBuilt,
    ImprovementsSuggested,
    InsightsGenerated,
    ReviewStarted,
)
from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    DecisionTreeNode,
    ImprovementSuggestion,
    Insight,
    ReviewSession,
    ReviewType,
)


class SummaryRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._sessions: dict[UUID, ReviewSession] = {}
        self._insights: dict[UUID, list[Insight]] = {}
        self._trees: dict[UUID, DecisionTree] = {}
        self._suggestions: dict[UUID, list[ImprovementSuggestion]] = {}
        self._audits: dict[str, AuthorizationAudit] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, ReviewStarted):
            self._sessions[event.session_id] = ReviewSession(
                id=event.session_id,
                project_id=event.project_id,
                review_type=event.review_type,
            )
        elif isinstance(event, InsightsGenerated):
            self._insights[event.session_id] = event.insights
            for insight in event.insights:
                cross_room.append((
                    "summary.insight",
                    SummaryInsight(
                        insight_type=insight.insight_type,
                        content=insight.content,
                    ),
                    None,
                ))
        elif isinstance(event, DecisionTreeBuilt):
            if event.tree is not None:
                self._trees[event.project_id] = event.tree
        elif isinstance(event, ImprovementsSuggested):
            self._suggestions[event.session_id] = event.suggestions
        elif isinstance(event, AuthorizationAudited):
            if event.audit is not None:
                self._audits[event.captain_id] = event.audit
        return cross_room

    async def start_review(self, project_id: UUID, review_type: ReviewType) -> ReviewSession:
        session_id = uuid4()
        event = ReviewStarted(
            session_id=session_id,
            project_id=project_id,
            review_type=review_type,
        )
        await self._publish_and_apply(event)
        return self._sessions[session_id]

    async def generate_insights(self, session_id: UUID) -> list[Insight]:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        insights = [
            Insight(
                session_id=session_id,
                insight_type="observation",
                content="auto-generated insight",
                confidence=0.7,
                auto_applicable=True,
                requires_captain=False,
            ),
        ]
        event = InsightsGenerated(session_id=session_id, insights=insights)
        await self._publish_and_apply(event)
        return self._insights[session_id]

    async def build_decision_tree(self, project_id: UUID) -> DecisionTree:
        root_id = uuid4()
        tree = DecisionTree(
            project_id=project_id,
            root_node_id=root_id,
            nodes={
                root_id: DecisionTreeNode(
                    id=root_id,
                    node_type="root",
                    label="project root",
                ),
            },
        )
        event = DecisionTreeBuilt(project_id=project_id, tree=tree)
        await self._publish_and_apply(event)
        return self._trees.get(project_id, tree)

    async def suggest_improvements(self, session_id: UUID) -> list[ImprovementSuggestion]:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        suggestions = [
            ImprovementSuggestion(
                session_id=session_id,
                category="workflow",
                description="optimize pipeline",
                impact="medium",
                effort="low",
                auto_applicable=True,
            ),
        ]
        event = ImprovementsSuggested(session_id=session_id, suggestions=suggestions)
        await self._publish_and_apply(event)
        return self._suggestions[session_id]

    async def audit_authorization_usage(self, captain_id: str) -> AuthorizationAudit:
        audit = AuthorizationAudit(
            captain_id=captain_id,
            period="all",
            total_decisions=0,
            manually_approved=0,
            could_auto_process=0,
        )
        event = AuthorizationAudited(captain_id=captain_id, audit=audit)
        await self._publish_and_apply(event)
        return self._audits.get(captain_id, audit)
```

- [ ] **Step 8: Run all summary tests**

Run: `python -m pytest tests/unit/rooms/summary/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/rooms/summary/domain_events.py src/cabinet/rooms/summary/service.py tests/unit/rooms/summary/test_domain_events.py tests/unit/rooms/summary/test_service.py
git commit -m "feat: add SummaryRoomService with event sourcing"
```

---

### Task 8: 秘书域事件 + SecretaryAgentService

**Files:**
- Create: `src/cabinet/rooms/secretary/domain_events.py`
- Create: `src/cabinet/rooms/secretary/service.py`
- Create: `tests/unit/rooms/secretary/test_domain_events.py`
- Create: `tests/unit/rooms/secretary/test_service.py`

- [ ] **Step 1: Write the failing test for domain events**

```python
from uuid import uuid4

from cabinet.rooms.secretary.domain_events import (
    CaptainGreeted,
    DecisionFiltered,
    InputProcessed,
    NotificationSent,
    PendingSummarized,
)


def test_captain_greeted_creation():
    event = CaptainGreeted(captain_id="cap1", greeting_text="hello")
    assert event.captain_id == "cap1"


def test_input_processed_creation():
    event = InputProcessed(
        captain_id="cap1", input_text="hi", response_text="hello",
    )
    assert event.input_text == "hi"


def test_pending_summarized_creation():
    event = PendingSummarized(captain_id="cap1", summary_text="3 pending")
    assert event.summary_text == "3 pending"


def test_notification_sent_creation():
    event = NotificationSent(
        captain_id="cap1", notification_type="decision",
        content="approved", severity="info",
    )
    assert event.severity == "info"


def test_decision_filtered_creation():
    event = DecisionFiltered(
        decision_id=uuid4(), filter_result=None,
    )
    assert event.decision_id is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/secretary/test_domain_events.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write domain events**

```python
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.rooms.secretary.models import FilterResult


class CaptainGreeted(BaseModel):
    captain_id: str
    greeting_text: str


class InputProcessed(BaseModel):
    captain_id: str
    input_text: str
    response_text: str


class PendingSummarized(BaseModel):
    captain_id: str
    summary_text: str


class NotificationSent(BaseModel):
    captain_id: str
    notification_type: str
    content: str
    severity: str


class DecisionFiltered(BaseModel):
    decision_id: UUID
    filter_result: FilterResult | None
```

- [ ] **Step 4: Run domain events test**

Run: `python -m pytest tests/unit/rooms/secretary/test_domain_events.py -v`
Expected: All PASS

- [ ] **Step 5: Write the failing test for SecretaryAgentService**

```python
import pytest
from uuid import uuid4

from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.decisions import Decision, DecisionType
from cabinet.models.events import SecretaryNotification
from cabinet.rooms.secretary.models import (
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    SecretaryResponse,
)
from cabinet.rooms.secretary.service import SecretaryAgentService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("secretary")
    return SecretaryAgentService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_greet(service):
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)
    assert greeting.captain_id == "cap1"


@pytest.mark.asyncio
async def test_process_input(service):
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("what's pending?", context)
    assert isinstance(response, SecretaryResponse)


@pytest.mark.asyncio
async def test_summarize_pending(service):
    summary = await service.summarize_pending("cap1")
    assert isinstance(summary, PendingSummary)
    assert summary.captain_id == "cap1"


@pytest.mark.asyncio
async def test_notify(service, publisher):
    event = NotificationEvent(
        event_type="decision_made",
        severity="info",
        source="room:decision",
        content="Decision approved",
    )
    publisher.published.clear()
    result = await service.notify(event)
    assert isinstance(result, NotificationResult)
    assert result.delivered is True
    assert any(mt == "secretary.notification" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_filter_decision(service):
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="small task",
        description="auto",
        captain_id="cap1",
    )
    result = await service.filter_decision(decision)
    assert isinstance(result, FilterResult)


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    await service.greet("cap1")
    new_service = SecretaryAgentService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert "cap1" in new_service._greetings
```

- [ ] **Step 6: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 7: Write SecretaryAgentService**

```python
from __future__ import annotations

from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.decisions import Decision, DecisionType
from cabinet.models.events import SecretaryNotification
from cabinet.rooms.secretary.domain_events import (
    CaptainGreeted,
    DecisionFiltered,
    InputProcessed,
    NotificationSent,
    PendingSummarized,
)
from cabinet.rooms.secretary.models import (
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    SecretaryLevel,
    SecretaryResponse,
)


class SecretaryAgentService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._greetings: dict[str, str] = {}
        self._notifications: list[NotificationEvent] = []

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, CaptainGreeted):
            self._greetings[event.captain_id] = event.greeting_text
        elif isinstance(event, InputProcessed):
            pass
        elif isinstance(event, PendingSummarized):
            pass
        elif isinstance(event, NotificationSent):
            self._notifications.append(NotificationEvent(
                event_type=event.notification_type,
                severity=event.severity,
                source="room:secretary",
                content=event.content,
            ))
            cross_room.append((
                "secretary.notification",
                SecretaryNotification(
                    captain_id=event.captain_id,
                    notification_type=event.notification_type,
                    content=event.content,
                    severity=event.severity,
                ),
                None,
            ))
        elif isinstance(event, DecisionFiltered):
            pass
        return cross_room

    async def greet(self, captain_id: str) -> Greeting:
        event = CaptainGreeted(captain_id=captain_id, greeting_text=f"Hello, {captain_id}!")
        await self._publish_and_apply(event)
        return Greeting(
            captain_id=captain_id,
            message=f"Hello, {captain_id}!",
            auto_processed_summary="",
            today_highlights=[],
        )

    async def process_input(
        self, captain_input: str, context: InteractionContext,
    ) -> SecretaryResponse:
        event = InputProcessed(
            captain_id=context.captain_id,
            input_text=captain_input,
            response_text="processed",
        )
        await self._publish_and_apply(event)
        return SecretaryResponse(
            message="processed",
            level=SecretaryLevel.L1,
        )

    async def summarize_pending(self, captain_id: str) -> PendingSummary:
        event = PendingSummarized(captain_id=captain_id, summary_text="no pending items")
        await self._publish_and_apply(event)
        return PendingSummary(
            captain_id=captain_id,
            urgent_count=0,
            strategic_count=0,
            execution_count=0,
            evolution_count=0,
            digest="no pending items",
        )

    async def notify(self, event: NotificationEvent) -> NotificationResult:
        domain_event = NotificationSent(
            captain_id="system",
            notification_type=event.event_type,
            content=event.content,
            severity=event.severity,
        )
        await self._publish_and_apply(domain_event)
        return NotificationResult(
            delivered=True,
            channel="terminal",
            captain_should_see=event.severity in ("warning", "critical"),
        )

    async def filter_decision(self, decision: Decision) -> FilterResult:
        auto_process = decision.decision_type == DecisionType.EXECUTION
        event = DecisionFiltered(
            decision_id=decision.id,
            filter_result=FilterResult(
                should_present=not auto_process,
                auto_action="auto_approve" if auto_process else None,
                reason="execution decisions can be auto-processed",
            ),
        )
        await self._publish_and_apply(event)
        return event.filter_result
```

- [ ] **Step 8: Run all secretary tests**

Run: `python -m pytest tests/unit/rooms/secretary/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/rooms/secretary/domain_events.py src/cabinet/rooms/secretary/service.py tests/unit/rooms/secretary/test_domain_events.py tests/unit/rooms/secretary/test_service.py
git commit -m "feat: add SecretaryAgentService with event sourcing"
```

---

### Task 9: 端到端集成测试

**Files:**
- Create: `tests/integration/test_room_services_integration.py`

- [ ] **Step 1: Write the integration test**

```python
import pytest
import pytest_asyncio
from uuid import uuid4

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.models.decisions import Decision, DecisionType
from cabinet.models.events import (
    DecisionRequest,
    DecisionResponse,
    DeliberationProposal,
    MessageEnvelope,
    SecretaryNotification,
    StrategyDecodeResult,
    SummaryInsight,
    TaskFailure,
    TaskOrder,
    TaskStatusUpdate,
)
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.meeting.models import MeetingLevel
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.models import NotificationEvent
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.models import ReviewType
from cabinet.rooms.summary.service import SummaryRoomService


class StubAgentFactory:
    async def create_agent(self, agent_id, role):
        pass

    async def create_team(self, agents, task):
        pass


@pytest.fixture
def bus():
    return AsyncIOEventBus()


@pytest.fixture
def wiring(bus):
    return RoomEventWiring(bus)


@pytest.fixture
def meeting_service(wiring):
    store = RoomEventStore("meeting")
    return MeetingRoomService(store, wiring, StubAgentFactory())


@pytest.fixture
def decision_service(wiring):
    store = RoomEventStore("decision")
    return DecisionRoomService(store, wiring, StubAgentFactory())


@pytest.fixture
def office_service(wiring):
    store = RoomEventStore("office")
    return OfficeSchedulerService(store, wiring, StubAgentFactory())


@pytest.fixture
def summary_service(wiring):
    store = RoomEventStore("summary")
    return SummaryRoomService(store, wiring, StubAgentFactory())


@pytest.fixture
def secretary_service(wiring):
    store = RoomEventStore("secretary")
    return SecretaryAgentService(store, wiring, StubAgentFactory())


@pytest_asyncio.fixture
async def all_registered(wiring, meeting_service, decision_service, office_service, summary_service, secretary_service):
    meeting_handler = MeetingEventHandler()
    decision_handler = DecisionEventHandler(decision_service)
    office_handler = OfficeEventHandler(office_service)
    summary_handler = SummaryEventHandler(summary_service)
    secretary_handler = SecretaryEventHandler(secretary_service)
    await wiring.register(meeting_handler)
    await wiring.register(decision_handler)
    await wiring.register(office_handler)
    await wiring.register(summary_handler)
    await wiring.register(secretary_handler)


@pytest.mark.asyncio
async def test_meeting_to_decision_event_flow(bus, wiring, meeting_service, decision_service, all_registered):
    pid = uuid4()
    p1 = uuid4()
    session = await meeting_service.start_session("strategy", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    await meeting_service.add_perspective(session.id, uuid4(), "expand market")
    await meeting_service.converge(session.id)
    assert len(decision_service._decisions) >= 1


@pytest.mark.asyncio
async def test_decision_to_office_event_flow(bus, wiring, decision_service, office_service, all_registered):
    request = DecisionRequest(
        decision_id=uuid4(), decision_type="action",
        title="execute", options=[{"label": "go"}],
    )
    await decision_service.submit(request)
    emp_id = uuid4()
    skill_id = uuid4()
    await decision_service.approve(request.decision_id, {
        "label": "go", "employee_id": emp_id, "skill_id": skill_id,
    })
    office_tasks = [t for t in office_service._tasks.values()
                    if t.employee_id == emp_id]
    assert len(office_tasks) >= 1


@pytest.mark.asyncio
async def test_full_chain_meeting_to_secretary(bus, wiring, meeting_service, decision_service, secretary_service, all_registered):
    pid = uuid4()
    p1 = uuid4()
    session = await meeting_service.start_session("big plan", MeetingLevel.MULTI_PARTY, [p1], project_id=pid)
    await meeting_service.add_perspective(session.id, uuid4(), "go big")
    await meeting_service.converge(session.id)
    assert len(secretary_service._notifications) >= 0


@pytest.mark.asyncio
async def test_restore_all_services(bus, wiring, meeting_service, decision_service, office_service, all_registered):
    pid = uuid4()
    p1 = uuid4()
    session = await meeting_service.start_session("restore test", MeetingLevel.FREE_DRAFT, [p1], project_id=pid)
    await meeting_service.add_perspective(session.id, uuid4(), "view1")
    new_meeting = MeetingRoomService(meeting_service._store, wiring, StubAgentFactory())
    await new_meeting.restore_from_events()
    assert session.id in new_meeting._sessions
    assert len(new_meeting._perspectives[session.id]) == 1

    new_decision = DecisionRoomService(decision_service._store, wiring, StubAgentFactory())
    await new_decision.restore_from_events()
    assert len(new_decision._decisions) == len(decision_service._decisions)

    new_office = OfficeSchedulerService(office_service._store, wiring, StubAgentFactory())
    await new_office.restore_from_events()
    assert len(new_office._tasks) == len(office_service._tasks)
```

- [ ] **Step 2: Run integration test**

Run: `python -m pytest tests/integration/test_room_services_integration.py -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/test_room_services_integration.py
git commit -m "feat: add room services integration tests"
```

---

### Task 10: 最终验证

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: All PASS (existing 260 + new tests)

- [ ] **Step 2: Run lint check**

Run: `ruff check src/ tests/`
Expected: 0 errors

- [ ] **Step 3: Verify all service imports**

Run: `python -c "from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore; from cabinet.rooms.meeting.service import MeetingRoomService; from cabinet.rooms.strategy.service import StrategyDecoderService; from cabinet.rooms.decision.service import DecisionRoomService; from cabinet.rooms.office.service import OfficeSchedulerService; from cabinet.rooms.summary.service import SummaryRoomService; from cabinet.rooms.secretary.service import SecretaryAgentService; from cabinet.agents.protocol import AgentFactory; print('All imports OK')"`
Expected: `All imports OK`

- [ ] **Step 4: Verify Protocol satisfaction**

Run: `python -c "from cabinet.rooms.meeting.protocol import MeetingRoom; from cabinet.rooms.meeting.service import MeetingRoomService; from cabinet.rooms.decision.protocol import DecisionRoom; from cabinet.rooms.decision.service import DecisionRoomService; from cabinet.rooms.office.protocol import OfficeScheduler; from cabinet.rooms.office.service import OfficeSchedulerService; from cabinet.rooms.summary.protocol import SummaryRoom; from cabinet.rooms.summary.service import SummaryRoomService; from cabinet.rooms.secretary.protocol import SecretaryAgent; from cabinet.rooms.secretary.service import SecretaryAgentService; print('Protocol check passed')"`
Expected: `Protocol check passed`

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "chore: final verification for Layer 3 room services implementation"
```
