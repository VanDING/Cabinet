# 事件溯源持久化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 SQLite 持久化的 EventStore 和 RoomEventStore，使系统状态可跨重启恢复，修复 test_event_contracts.py 收集错误

**Architecture:** 创建 SqliteEventStore 和 SqliteRoomEventStore 替代内存实现，通过事件类型注册表反序列化领域事件，CabinetRuntime 新增 db_path 参数选择存储后端，默认 None 保持内存模式

**Tech Stack:** Python 3.12+, aiosqlite, Pydantic v2, pytest, pytest-asyncio

---

### Task 1: 事件类型注册表

**Files:**
- Create: `src/cabinet/core/events/event_registry.py`
- Create: `tests/unit/core/events/test_event_registry.py`

- [ ] **Step 1: 编写事件注册表测试**

创建 `tests/unit/core/events/test_event_registry.py`：

```python
import pytest
from pydantic import BaseModel
from uuid import UUID, uuid4

from cabinet.core.events.event_registry import deserialize_event, register_event_type


class SampleEvent(BaseModel):
    item_id: UUID
    name: str


def test_register_and_deserialize():
    register_event_type(SampleEvent)
    event = SampleEvent(item_id=uuid4(), name="test")
    data = event.model_dump_json()
    restored = deserialize_event("SampleEvent", data)
    assert isinstance(restored, SampleEvent)
    assert restored.name == "test"
    assert restored.item_id == event.item_id


def test_deserialize_unknown_type_raises():
    with pytest.raises(KeyError):
        deserialize_event("NonExistentEvent", "{}")
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/events/test_event_registry.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: 实现事件注册表**

创建 `src/cabinet/core/events/event_registry.py`：

```python
from __future__ import annotations

from pydantic import BaseModel

_EVENT_REGISTRY: dict[str, type[BaseModel]] = {}


def register_event_type(event_type: type[BaseModel]) -> None:
    _EVENT_REGISTRY[event_type.__name__] = event_type


def deserialize_event(type_name: str, data: str) -> BaseModel:
    cls = _EVENT_REGISTRY[type_name]
    return cls.model_validate_json(data)
```

- [ ] **Step 4: 运行测试验证通过**

Run: `python -m pytest tests/unit/core/events/test_event_registry.py -v`
Expected: ALL PASS

- [ ] **Step 5: 在 6 个 domain_events.py 中注册所有事件类型**

在每个 `domain_events.py` 文件末尾追加注册代码。

修改 `src/cabinet/rooms/meeting/domain_events.py`，在文件末尾追加：

```python
from cabinet.core.events.event_registry import register_event_type

register_event_type(SessionStarted)
register_event_type(PerspectiveAdded)
register_event_type(CrossValidationCompleted)
register_event_type(ConvergenceAchieved)
register_event_type(ExpertWoken)
register_event_type(SessionClosed)
```

修改 `src/cabinet/rooms/strategy/domain_events.py`，在文件末尾追加：

```python
from cabinet.core.events.event_registry import register_event_type

register_event_type(BlueprintDecoded)
register_event_type(BlueprintValidated)
```

修改 `src/cabinet/rooms/decision/domain_events.py`，在文件末尾追加：

```python
from cabinet.core.events.event_registry import register_event_type

register_event_type(DecisionSubmitted)
register_event_type(DecisionApproved)
register_event_type(DecisionRejected)
register_event_type(DecisionDelegated)
register_event_type(AuthorizationRuleSet)
register_event_type(DecisionCascaded)
```

修改 `src/cabinet/rooms/office/domain_events.py`，在文件末尾追加：

```python
from cabinet.core.events.event_registry import register_event_type

register_event_type(TaskSubmitted)
register_event_type(TaskCancelled)
register_event_type(TaskStatusChanged)
register_event_type(TaskFailed)
register_event_type(WorkflowStarted)
register_event_type(WorkflowNodeCompleted)
register_event_type(WorkflowCompleted)
register_event_type(WorkflowPaused)
```

修改 `src/cabinet/rooms/summary/domain_events.py`，在文件末尾追加：

```python
from cabinet.core.events.event_registry import register_event_type

register_event_type(ReviewStarted)
register_event_type(InsightsGenerated)
register_event_type(DecisionTreeBuilt)
register_event_type(ImprovementsSuggested)
register_event_type(AuthorizationAudited)
```

修改 `src/cabinet/rooms/secretary/domain_events.py`，在文件末尾追加：

```python
from cabinet.core.events.event_registry import register_event_type

register_event_type(CaptainGreeted)
register_event_type(InputProcessed)
register_event_type(PendingSummarized)
register_event_type(NotificationSent)
register_event_type(DecisionFiltered)
```

- [ ] **Step 6: 运行全量测试确认无回归**

Run: `python -m pytest -v`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/core/events/event_registry.py tests/unit/core/events/test_event_registry.py src/cabinet/rooms/*/domain_events.py
git commit -m "feat: add event type registry for deserialization"
```

---

### Task 2: SqliteEventStore — 跨房间消息持久化

**Files:**
- Create: `src/cabinet/core/events/sqlite_store.py`
- Create: `tests/unit/core/events/test_sqlite_store.py`
- Modify: `src/cabinet/core/events/store.py` (append 改为 async)
- Modify: `src/cabinet/core/events/asyncio_bus.py` (接受外部 EventStore)

- [ ] **Step 1: 编写 SqliteEventStore 测试**

创建 `tests/unit/core/events/test_sqlite_store.py`：

```python
import pytest
import pytest_asyncio
from uuid import uuid4

from cabinet.core.events.sqlite_store import SqliteEventStore
from cabinet.models.events import MessageEnvelope


@pytest_asyncio.fixture
async def store(tmp_path):
    db_path = str(tmp_path / "test.db")
    s = SqliteEventStore(db_path)
    await s.initialize()
    yield s
    await s.close()


@pytest.mark.asyncio
async def test_sqlite_store_append_and_get(store):
    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "expand"},
    )
    await store.append(env)
    result = await store.get(env.message_id)
    assert result is not None
    assert result.message_id == env.message_id
    assert result.message_type == "deliberation.proposal"
    assert result.payload == {"proposal_text": "expand"}


@pytest.mark.asyncio
async def test_sqlite_store_get_returns_none_for_missing(store):
    result = await store.get(uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_sqlite_store_get_by_type(store):
    env1 = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "a"},
    )
    env2 = MessageEnvelope(
        sender="room:decision",
        recipients=["room:office"],
        message_type="decision.response",
        payload={"action": "approve"},
    )
    await store.append(env1)
    await store.append(env2)
    proposals = await store.get_by_type("deliberation.proposal")
    assert len(proposals) == 1
    assert proposals[0].message_id == env1.message_id


@pytest.mark.asyncio
async def test_sqlite_store_causation_chain(store):
    env1 = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal": "expand"},
    )
    await store.append(env1)
    env2 = MessageEnvelope(
        sender="room:decision",
        recipients=["room:office"],
        message_type="task.order",
        payload={"task": "research"},
        causation_id=env1.message_id,
    )
    await store.append(env2)
    chain = await store.get_causation_chain(env2.message_id)
    assert len(chain) == 2
    assert chain[0].message_id == env1.message_id
    assert chain[1].message_id == env2.message_id


@pytest.mark.asyncio
async def test_sqlite_store_persists_across_reopen(tmp_path):
    db_path = str(tmp_path / "persist.db")
    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "persist test"},
    )
    store1 = SqliteEventStore(db_path)
    await store1.initialize()
    await store1.append(env)
    await store1.close()

    store2 = SqliteEventStore(db_path)
    await store2.initialize()
    result = await store2.get(env.message_id)
    await store2.close()
    assert result is not None
    assert result.payload == {"proposal_text": "persist test"}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/events/test_sqlite_store.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: 实现 SqliteEventStore**

创建 `src/cabinet/core/events/sqlite_store.py`：

```python
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

import aiosqlite

from cabinet.models.events import MessageEnvelope


class SqliteEventStore:
    def __init__(self, db_path: str = "data/db/cabinet.db"):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS event_store (
                message_id TEXT PRIMARY KEY,
                correlation_id TEXT NOT NULL,
                causation_id TEXT NOT NULL,
                sender TEXT NOT NULL,
                recipients TEXT NOT NULL,
                message_type TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                payload TEXT NOT NULL
            )
            """
        )
        await self._db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_store_type ON event_store(message_type)"
        )
        await self._db.commit()

    async def append(self, envelope: MessageEnvelope) -> None:
        await self._db.execute(
            """
            INSERT OR REPLACE INTO event_store
            (message_id, correlation_id, causation_id, sender, recipients,
             message_type, timestamp, status, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(envelope.message_id),
                str(envelope.correlation_id),
                str(envelope.causation_id),
                envelope.sender,
                json.dumps(envelope.recipients),
                envelope.message_type,
                envelope.timestamp.isoformat(),
                envelope.status,
                json.dumps(envelope.payload),
            ),
        )
        await self._db.commit()

    async def get(self, message_id: UUID) -> MessageEnvelope | None:
        cursor = await self._db.execute(
            "SELECT * FROM event_store WHERE message_id = ?",
            (str(message_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return self._row_to_envelope(row)

    async def get_by_type(self, message_type: str) -> list[MessageEnvelope]:
        cursor = await self._db.execute(
            "SELECT * FROM event_store WHERE message_type = ?",
            (message_type,),
        )
        rows = await cursor.fetchall()
        return [self._row_to_envelope(row) for row in rows]

    async def get_causation_chain(self, message_id: UUID) -> list[MessageEnvelope]:
        chain = []
        current_id = str(message_id)
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            cursor = await self._db.execute(
                "SELECT * FROM event_store WHERE message_id = ?",
                (current_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                break
            chain.append(self._row_to_envelope(row))
            causation = row["causation_id"]
            current_id = causation if causation != row["message_id"] else None
        chain.reverse()
        return chain

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    def _row_to_envelope(self, row: aiosqlite.Row) -> MessageEnvelope:
        return MessageEnvelope(
            message_id=UUID(row["message_id"]),
            correlation_id=UUID(row["correlation_id"]),
            causation_id=UUID(row["causation_id"]),
            sender=row["sender"],
            recipients=json.loads(row["recipients"]),
            message_type=row["message_type"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            status=row["status"],
            payload=json.loads(row["payload"]),
        )
```

- [ ] **Step 4: 运行 SqliteEventStore 测试验证通过**

Run: `python -m pytest tests/unit/core/events/test_sqlite_store.py -v`
Expected: ALL PASS

- [ ] **Step 5: 修改 EventStore.append() 为 async**

修改 `src/cabinet/core/events/store.py`，将 `append` 方法改为 async：

将：
```python
    def append(self, envelope: MessageEnvelope) -> None:
```
改为：
```python
    async def append(self, envelope: MessageEnvelope) -> None:
```

- [ ] **Step 6: 修改 AsyncIOEventBus 接受外部 EventStore 并 await append**

修改 `src/cabinet/core/events/asyncio_bus.py`：

将：
```python
class AsyncIOEventBus:
    def __init__(self):
        self._handlers: dict[str, list] = defaultdict(list)
        self._store = EventStore()

    async def publish(self, envelope: MessageEnvelope) -> None:
        self._store.append(envelope)
```
改为：
```python
class AsyncIOEventBus:
    def __init__(self, event_store: EventStore | None = None):
        self._handlers: dict[str, list] = defaultdict(list)
        self._store = event_store or EventStore()

    async def publish(self, envelope: MessageEnvelope) -> None:
        await self._store.append(envelope)
```

- [ ] **Step 7: 更新 EventStore 测试中的同步调用**

修改 `tests/unit/core/events/test_asyncio_bus.py` 第37行和第98行，将 `store.append` 改为 `await store.append`：

在 `test_publish_and_subscribe` 中，第37行无直接 store.append 调用，无需修改。

在 `test_event_store` 中，第96行：

将：
```python
    store.append(env)
```
改为：
```python
    await store.append(env)
```

并在函数签名上添加 `async`：

将：
```python
async def test_event_store():
```
保持不变（已经是 async）。

- [ ] **Step 8: 运行全量测试确认无回归**

Run: `python -m pytest tests/unit/core/events/ -v`
Expected: ALL PASS

- [ ] **Step 9: 提交**

```bash
git add src/cabinet/core/events/sqlite_store.py src/cabinet/core/events/store.py src/cabinet/core/events/asyncio_bus.py tests/unit/core/events/test_sqlite_store.py tests/unit/core/events/test_asyncio_bus.py
git commit -m "feat: add SqliteEventStore and async EventStore.append"
```

---

### Task 3: SqliteRoomEventStore — Room 领域事件持久化

**Files:**
- Create: `src/cabinet/core/events/sqlite_room_store.py`
- Create: `tests/unit/core/events/test_sqlite_room_store.py`
- Modify: `src/cabinet/core/events/event_sourced.py` (flush 支持)

- [ ] **Step 1: 编写 SqliteRoomEventStore 测试**

创建 `tests/unit/core/events/test_sqlite_room_store.py`：

```python
import pytest
import pytest_asyncio
from uuid import uuid4

from pydantic import BaseModel

from cabinet.core.events.event_registry import register_event_type
from cabinet.core.events.sqlite_room_store import SqliteRoomEventStore


class TestEvent(BaseModel):
    item_id: uuid4.__class__
    name: str


class PersistItem(BaseModel):
    item_id: uuid4.__class__
    value: str


register_event_type(TestEvent)
register_event_type(PersistItem)


@pytest_asyncio.fixture
async def store(tmp_path):
    db_path = str(tmp_path / "room.db")
    s = SqliteRoomEventStore("test_room", db_path)
    await s.initialize()
    yield s
    await s.close()


def test_sqlite_room_store_append_and_get_all(store):
    e1 = TestEvent(item_id=uuid4(), name="hello")
    e2 = PersistItem(item_id=uuid4(), value="world")
    store.append(e1)
    store.append(e2)
    all_events = store.get_all()
    assert len(all_events) == 2
    assert all_events[0].name == "hello"
    assert all_events[1].value == "world"


def test_sqlite_room_store_get_by_type(store):
    e1 = TestEvent(item_id=uuid4(), name="hello")
    e2 = PersistItem(item_id=uuid4(), value="world")
    e3 = TestEvent(item_id=uuid4(), name="foo")
    store.append(e1)
    store.append(e2)
    store.append(e3)
    test_events = store.get_by_type(TestEvent)
    assert len(test_events) == 2


def test_sqlite_room_store_clear(store):
    store.append(TestEvent(item_id=uuid4(), name="x"))
    store.clear()
    assert store.get_all() == []


def test_sqlite_room_store_get_all_returns_copy(store):
    store.append(TestEvent(item_id=uuid4(), name="x"))
    events = store.get_all()
    events.clear()
    assert len(store.get_all()) == 1


@pytest.mark.asyncio
async def test_sqlite_room_store_persists_across_reopen(tmp_path):
    db_path = str(tmp_path / "persist_room.db")
    e1 = TestEvent(item_id=uuid4(), name="persisted")

    store1 = SqliteRoomEventStore("test_room", db_path)
    await store1.initialize()
    store1.append(e1)
    await store1.flush()
    await store1.close()

    store2 = SqliteRoomEventStore("test_room", db_path)
    await store2.initialize()
    all_events = store2.get_all()
    await store2.close()
    assert len(all_events) == 1
    assert all_events[0].name == "persisted"


@pytest.mark.asyncio
async def test_sqlite_room_store_restore_from_events(tmp_path):
    db_path = str(tmp_path / "restore_room.db")
    e1 = TestEvent(item_id=uuid4(), name="first")
    e2 = PersistItem(item_id=uuid4(), value="second")

    store1 = SqliteRoomEventStore("test_room", db_path)
    await store1.initialize()
    store1.append(e1)
    store1.append(e2)
    await store1.flush()
    await store1.close()

    store2 = SqliteRoomEventStore("test_room", db_path)
    await store2.initialize()
    test_events = store2.get_by_type(TestEvent)
    await store2.close()
    assert len(test_events) == 1
    assert test_events[0].name == "first"
```

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/core/events/test_sqlite_room_store.py -v`
Expected: FAIL — ModuleNotFoundError

- [ ] **Step 3: 实现 SqliteRoomEventStore**

创建 `src/cabinet/core/events/sqlite_room_store.py`：

```python
from __future__ import annotations

from typing import Type, TypeVar

import aiosqlite
from pydantic import BaseModel

from cabinet.core.events.event_registry import deserialize_event

T = TypeVar("T", bound=BaseModel)


class SqliteRoomEventStore:
    def __init__(self, room_name: str, db_path: str = "data/db/cabinet.db"):
        self._room_name = room_name
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None
        self._cache: list[BaseModel] = []
        self._persisted_count: int = 0

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS room_events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                room_name TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_data TEXT NOT NULL
            )
            """
        )
        await self._db.execute(
            "CREATE INDEX IF NOT EXISTS idx_room_events_room ON room_events(room_name)"
        )
        await self._db.commit()
        await self._load_cache()

    def append(self, event: BaseModel) -> None:
        self._cache.append(event)

    def get_all(self) -> list[BaseModel]:
        return list(self._cache)

    def get_by_type(self, event_type: Type[T]) -> list[T]:
        return [e for e in self._cache if isinstance(e, event_type)]

    def clear(self) -> None:
        self._cache.clear()
        self._persisted_count = 0

    async def flush(self) -> None:
        new_events = self._cache[self._persisted_count:]
        if not new_events:
            return
        for event in new_events:
            await self._db.execute(
                "INSERT INTO room_events (room_name, event_type, event_data) VALUES (?, ?, ?)",
                (self._room_name, type(event).__name__, event.model_dump_json()),
            )
        await self._db.commit()
        self._persisted_count = len(self._cache)

    async def _load_cache(self) -> None:
        cursor = await self._db.execute(
            "SELECT event_type, event_data FROM room_events WHERE room_name = ? ORDER BY seq",
            (self._room_name,),
        )
        rows = await cursor.fetchall()
        for type_name, data in rows:
            event = deserialize_event(type_name, data)
            self._cache.append(event)
        self._persisted_count = len(self._cache)

    async def close(self) -> None:
        await self.flush()
        if self._db:
            await self._db.close()
            self._db = None

    @property
    def room_name(self) -> str:
        return self._room_name
```

- [ ] **Step 4: 运行 SqliteRoomEventStore 测试验证通过**

Run: `python -m pytest tests/unit/core/events/test_sqlite_room_store.py -v`
Expected: ALL PASS

- [ ] **Step 5: 修改 EventSourcedRoom._publish_and_apply 支持 flush**

修改 `src/cabinet/core/events/event_sourced.py` 第45-54行：

将：
```python
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
```
改为：
```python
    async def _publish_and_apply(self, event: BaseModel) -> None:
        self._store.append(event)
        if hasattr(self._store, "flush"):
            await self._store.flush()
        cross_room_events = self._apply_event(event)
        for message_type, payload, causation_id in cross_room_events:
            await self._publisher.publish(
                room_name=self._store.room_name,
                message_type=message_type,
                payload=payload,
                causation_id=causation_id,
            )
```

- [ ] **Step 6: 运行全量事件溯源测试确认无回归**

Run: `python -m pytest tests/unit/core/events/test_event_sourced.py tests/unit/core/events/test_sqlite_room_store.py -v`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/core/events/sqlite_room_store.py src/cabinet/core/events/event_sourced.py tests/unit/core/events/test_sqlite_room_store.py
git commit -m "feat: add SqliteRoomEventStore with flush support"
```

---

### Task 4: CabinetRuntime 集成持久化

**Files:**
- Modify: `src/cabinet/runtime.py`
- Modify: `tests/unit/test_runtime.py`
- Modify: `tests/integration/test_runtime.py`

- [ ] **Step 1: 编写 CabinetRuntime 持久化模式测试**

在 `tests/unit/test_runtime.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_runtime_with_db_path_creates_sqlite_stores(tmp_path):
    from cabinet.core.events.sqlite_room_store import SqliteRoomEventStore
    from cabinet.core.events.sqlite_store import SqliteEventStore

    db_path = str(tmp_path / "runtime.db")
    runtime = CabinetRuntime(db_path=db_path)
    await runtime.start()
    assert isinstance(runtime._event_store, SqliteEventStore)
    assert isinstance(runtime.meeting._store, SqliteRoomEventStore)
    assert isinstance(runtime.decision._store, SqliteRoomEventStore)
    await runtime.stop()


@pytest.mark.asyncio
async def test_runtime_without_db_path_uses_memory_stores():
    from cabinet.core.events.event_sourced import RoomEventStore
    from cabinet.core.events.store import EventStore

    runtime = CabinetRuntime()
    assert isinstance(runtime._event_store, EventStore)
    assert isinstance(runtime.meeting._store, RoomEventStore)


@pytest.mark.asyncio
async def test_runtime_persistence_across_restart(tmp_path):
    db_path = str(tmp_path / "persist.db")
    pid = uuid4()
    p1 = uuid4()

    rt1 = CabinetRuntime(db_path=db_path)
    await rt1.start()
    session = await rt1.meeting.start_session(
        "persist test", MeetingLevel.FREE_DRAFT, [p1], project_id=pid,
    )
    await rt1.meeting.add_perspective(session.id, uuid4(), "view1")
    await rt1.stop()

    rt2 = CabinetRuntime(db_path=db_path)
    await rt2.start()
    assert session.id in rt2.meeting._sessions
    assert len(rt2.meeting._perspectives[session.id]) == 1
    await rt2.stop()
```

注意：需要在文件顶部添加 `from uuid import uuid4` 和 `from cabinet.rooms.meeting.models import MeetingLevel`（如果尚未导入）。

- [ ] **Step 2: 运行测试验证失败**

Run: `python -m pytest tests/unit/test_runtime.py::test_runtime_with_db_path_creates_sqlite_stores -v`
Expected: FAIL — CabinetRuntime.__init__() 不接受 db_path 参数

- [ ] **Step 3: 修改 CabinetRuntime 支持 db_path**

替换 `src/cabinet/runtime.py` 的 `CabinetRuntime.__init__` 方法：

将：
```python
class CabinetRuntime:
    def __init__(self, agent_factory: AgentFactory | None = None, gateway: object | None = None):
        self._agent_factory = agent_factory or StubAgentFactory()
        self._bus = AsyncIOEventBus()
        self._wiring = RoomEventWiring(self._bus)

        self._evaluator = DefaultEvaluator(gateway=gateway)
        self._verification_gate = WorkflowVerificationGate(evaluator=self._evaluator)
        self._escalation_protocol = DefaultEscalationProtocol(rules=[])
        self._workflow_engine = WorkflowEngine(
            agent_factory=self._agent_factory,
            verification_gate=self._verification_gate,
        )

        self._meeting_store = RoomEventStore("meeting")
        self._strategy_store = RoomEventStore("strategy")
        self._decision_store = RoomEventStore("decision")
        self._office_store = RoomEventStore("office")
        self._summary_store = RoomEventStore("summary")
        self._secretary_store = RoomEventStore("secretary")
```
改为：
```python
class CabinetRuntime:
    def __init__(self, agent_factory: AgentFactory | None = None, gateway: object | None = None, db_path: str | None = None):
        self._agent_factory = agent_factory or StubAgentFactory()
        self._db_path = db_path

        if db_path:
            from cabinet.core.events.sqlite_store import SqliteEventStore
            from cabinet.core.events.sqlite_room_store import SqliteRoomEventStore

            self._event_store = SqliteEventStore(db_path)
            self._bus = AsyncIOEventBus(event_store=self._event_store)
            self._meeting_store = SqliteRoomEventStore("meeting", db_path)
            self._strategy_store = SqliteRoomEventStore("strategy", db_path)
            self._decision_store = SqliteRoomEventStore("decision", db_path)
            self._office_store = SqliteRoomEventStore("office", db_path)
            self._summary_store = SqliteRoomEventStore("summary", db_path)
            self._secretary_store = SqliteRoomEventStore("secretary", db_path)
        else:
            self._event_store = EventStore()
            self._bus = AsyncIOEventBus(event_store=self._event_store)
            self._meeting_store = RoomEventStore("meeting")
            self._strategy_store = RoomEventStore("strategy")
            self._decision_store = RoomEventStore("decision")
            self._office_store = RoomEventStore("office")
            self._summary_store = RoomEventStore("summary")
            self._secretary_store = RoomEventStore("secretary")

        self._wiring = RoomEventWiring(self._bus)

        self._evaluator = DefaultEvaluator(gateway=gateway)
        self._verification_gate = WorkflowVerificationGate(evaluator=self._evaluator)
        self._escalation_protocol = DefaultEscalationProtocol(rules=[])
        self._workflow_engine = WorkflowEngine(
            agent_factory=self._agent_factory,
            verification_gate=self._verification_gate,
        )
```

同时需要在文件顶部添加 `from cabinet.core.events.store import EventStore` 导入（如果尚未导入）。

- [ ] **Step 4: 修改 CabinetRuntime.start() 初始化 SQLite**

将：
```python
    async def start(self) -> None:
        await self._wiring.register(self._meeting_handler)
```
改为：
```python
    async def start(self) -> None:
        if self._db_path:
            await self._event_store.initialize()
            for store in self._room_stores:
                await store.initialize()
        await self._wiring.register(self._meeting_handler)
```

需要在 `__init__` 末尾添加 `_room_stores` 属性：

在 `self._secretary_handler = SecretaryEventHandler(self._secretary)` 之后追加：

```python
        self._room_stores = [
            self._meeting_store,
            self._strategy_store,
            self._decision_store,
            self._office_store,
            self._summary_store,
            self._secretary_store,
        ]
```

- [ ] **Step 5: 修改 CabinetRuntime.stop() 关闭 SQLite**

将：
```python
    async def stop(self) -> None:
        await self._wiring.unregister_all()
```
改为：
```python
    async def stop(self) -> None:
        await self._wiring.unregister_all()
        if self._db_path:
            for store in self._room_stores:
                await store.close()
            await self._event_store.close()
```

- [ ] **Step 6: 运行 CabinetRuntime 测试验证通过**

Run: `python -m pytest tests/unit/test_runtime.py -v`
Expected: ALL PASS

- [ ] **Step 7: 运行集成测试验证通过**

Run: `python -m pytest tests/integration/test_runtime.py -v`
Expected: ALL PASS

- [ ] **Step 8: 提交**

```bash
git add src/cabinet/runtime.py tests/unit/test_runtime.py
git commit -m "feat: integrate SQLite persistence into CabinetRuntime"
```

---

### Task 5: 修复 test_event_contracts.py 收集错误

**Files:**
- Modify: `tests/unit/core/events/test_event_contracts.py`

- [ ] **Step 1: 重写 test_event_contracts.py 使用 fixture**

替换 `tests/unit/core/events/test_event_contracts.py` 全部内容：

```python
import pytest
from unittest.mock import AsyncMock

from cabinet.core.events.wiring import EventContract
from cabinet.models.events import MessageType
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.protocol import DecisionRoom
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.protocol import OfficeScheduler
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.protocol import SecretaryAgent
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.protocol import StrategyDecoder
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.protocol import SummaryRoom


@pytest.fixture(scope="module")
def all_contracts():
    contracts = []
    contracts.append(MeetingEventHandler().contract)
    contracts.append(StrategyEventHandler(AsyncMock(spec=StrategyDecoder)).contract)
    contracts.append(DecisionEventHandler(AsyncMock(spec=DecisionRoom)).contract)
    contracts.append(OfficeEventHandler(AsyncMock(spec=OfficeScheduler)).contract)
    contracts.append(SummaryEventHandler(AsyncMock(spec=SummaryRoom)).contract)
    contracts.append(SecretaryEventHandler(AsyncMock(spec=SecretaryAgent)).contract)
    return contracts


def test_all_produced_events_have_message_type(all_contracts):
    valid_types = {mt.value for mt in MessageType}
    for contract in all_contracts:
        for produced in contract.produces:
            assert produced in valid_types, (
                f"Room '{contract.room_name}' produces '{produced}' which is not in MessageType enum"
            )


def test_all_consumed_events_have_message_type(all_contracts):
    valid_types = {mt.value for mt in MessageType}
    for contract in all_contracts:
        for consumed in contract.consumes:
            assert consumed in valid_types, (
                f"Room '{contract.room_name}' consumes '{consumed}' which is not in MessageType enum"
            )


_EXTERNAL_EVENT_SOURCES = {
    "decision.request",
    "summary.review_request",
    "harness.evaluation_result",
}


def test_every_consumed_event_has_producer(all_contracts):
    all_produced = set()
    for contract in all_contracts:
        all_produced.update(contract.produces)

    for contract in all_contracts:
        for consumed in contract.consumes:
            assert consumed in all_produced or consumed in _EXTERNAL_EVENT_SOURCES, (
                f"Room '{contract.room_name}' consumes '{consumed}' but no room produces it"
            )


def test_room_names_are_unique(all_contracts):
    names = [c.room_name for c in all_contracts]
    assert len(names) == len(set(names)), f"Duplicate room names: {names}"


def test_six_rooms_registered(all_contracts):
    assert len(all_contracts) == 6
```

- [ ] **Step 2: 运行测试验证通过**

Run: `python -m pytest tests/unit/core/events/test_event_contracts.py -v`
Expected: ALL PASS

- [ ] **Step 3: 提交**

```bash
git add tests/unit/core/events/test_event_contracts.py
git commit -m "fix: convert test_event_contracts to fixture-based collection"
```

---

### Task 6: 全量验证

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest -v`
Expected: ALL PASS (430+ tests)

- [ ] **Step 2: 运行 ruff check**

Run: `ruff check src/ tests/`
Expected: 0 errors

- [ ] **Step 3: 验证持久化集成测试**

Run: `python -m pytest tests/unit/test_runtime.py::test_runtime_persistence_across_restart tests/unit/core/events/test_sqlite_store.py tests/unit/core/events/test_sqlite_room_store.py -v`
Expected: ALL PASS — SQLite 持久化端到端验证通过
