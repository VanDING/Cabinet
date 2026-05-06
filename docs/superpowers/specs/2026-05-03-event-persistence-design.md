# 事件溯源持久化 设计规格

日期: 2026-05-03

## 目标

1. 实现 SQLite 持久化的 EventStore 和 RoomEventStore，使系统状态可跨重启恢复
2. 修复 test_event_contracts.py 收集错误
3. 保持向后兼容 — 默认内存模式不变

## 范围

| 组件 | 变更类型 | 优先级 |
|------|----------|--------|
| SqliteEventStore | 新建 | P0 |
| SqliteRoomEventStore | 新建 | P0 |
| 事件类型注册表 | 新建 | P0 |
| AsyncIOEventBus | 修改（接受外部 EventStore） | P1 |
| CabinetRuntime | 修改（新增 db_path 参数） | P1 |
| test_event_contracts.py | 修复收集错误 | P0 |

**不在范围内：** 死信队列、Protocol 接口抽象、UI 层

## 设计详情

### 1. SqliteEventStore — 跨房间消息持久化

**当前：** `EventStore` 为纯内存 `dict[UUID, MessageEnvelope]`，被 `AsyncIOEventBus` 使用

**新建文件：** `src/cabinet/core/events/sqlite_store.py`

**表结构：**

```sql
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
);
CREATE INDEX IF NOT EXISTS idx_event_store_type ON event_store(message_type);
```

**类接口：**

```python
class SqliteEventStore:
    def __init__(self, db_path: str = "data/db/cabinet.db"):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        # 建表 + 建索引
        await self._db.commit()

    async def append(self, envelope: MessageEnvelope) -> None:
        # INSERT OR REPLACE into event_store
        await self._db.commit()

    async def get(self, message_id: UUID) -> MessageEnvelope | None:
        # SELECT by message_id, 反序列化为 MessageEnvelope

    async def get_by_type(self, message_type: str) -> list[MessageEnvelope]:
        # SELECT by message_type

    async def get_causation_chain(self, message_id: UUID) -> list[MessageEnvelope]:
        # 递归查询 causation_id 链

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None
```

**序列化策略：**
- `recipients`: `json.dumps(envelope.recipients)`
- `payload`: `json.dumps(envelope.payload)`
- `timestamp`: `envelope.timestamp.isoformat()`
- `UUID` 字段: `str(uuid)`

**反序列化策略：**
- `recipients`: `json.loads(row["recipients"])`
- `payload`: `json.loads(row["payload"])`
- `timestamp`: `datetime.fromisoformat(row["timestamp"])`
- `UUID` 字段: `UUID(row["field"])`

### 2. SqliteRoomEventStore — Room 领域事件持久化

**当前：** `RoomEventStore` 为纯内存 `list[BaseModel]`，被 6 个 Room Service 使用

**关键约束：** `RoomEventStore.append()` 和 `get_all()` 是同步方法，被 `_publish_and_apply()` 同步调用

**新建文件：** `src/cabinet/core/events/sqlite_room_store.py`

**表结构：**

```sql
CREATE TABLE IF NOT EXISTS room_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    room_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_events_room ON room_events(room_name);
```

**类接口：**

```python
class SqliteRoomEventStore:
    def __init__(self, room_name: str, db_path: str = "data/db/cabinet.db"):
        self._room_name = room_name
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None
        self._cache: list[BaseModel] = []

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        # 建表 + 建索引
        # 从 SQLite 加载已有事件到 _cache
        await self._db.commit()
        await self._load_cache()

    def append(self, event: BaseModel) -> None:
        self._cache.append(event)
        # 同步写入：使用 _db 的同步方法或排入写入队列
        # 实际方案：在 _publish_and_apply 后由 EventSourcedRoom 统一刷盘

    def get_all(self) -> list[BaseModel]:
        return list(self._cache)

    def get_by_type(self, event_type: Type[T]) -> list[T]:
        return [e for e in self._cache if isinstance(e, event_type)]

    def clear(self) -> None:
        self._cache.clear()

    async def flush(self) -> None:
        # 将 _cache 中未持久化的事件写入 SQLite
        for event in self._cache:
            await self._db.execute(
                "INSERT INTO room_events (room_name, event_type, event_data) VALUES (?, ?, ?)",
                (self._room_name, type(event).__name__, event.model_dump_json()),
            )
        await self._db.commit()

    async def _load_cache(self) -> None:
        cursor = await self._db.execute(
            "SELECT event_type, event_data FROM room_events WHERE room_name = ? ORDER BY seq",
            (self._room_name,),
        )
        rows = await cursor.fetchall()
        for type_name, data in rows:
            event = deserialize_event(type_name, data)
            self._cache.append(event)

    async def close(self) -> None:
        await self.flush()
        if self._db:
            await self._db.close()
            self._db = None
```

**同步/异步策略：**

`RoomEventStore` 的 `append()` 是同步方法，但 `aiosqlite` 是异步库。解决方案：

1. `append()` 仅写入内存 `_cache`（同步）
2. `EventSourcedRoom._publish_and_apply()` 调用 `append()` 后，异步调用 `store.flush()` 持久化
3. 修改 `_publish_and_apply()` 在 `append()` 后增加异步刷盘

```python
async def _publish_and_apply(self, event: BaseModel) -> None:
    self._store.append(event)
    if hasattr(self._store, 'flush'):
        await self._store.flush()
    cross_room_events = self._apply_event(event)
    for message_type, payload, causation_id in cross_room_events:
        await self._publisher.publish(...)
```

**关键决策：**
- `flush()` 每次调用时检查是否有新事件需要写入，避免重复写入
- 使用 `_persisted_count` 计数器追踪已持久化的事件数量
- `clear()` 同时清空内存缓存和 SQLite 表

### 3. 事件类型注册表

**新建文件：** `src/cabinet/core/events/event_registry.py`

```python
from pydantic import BaseModel

_EVENT_REGISTRY: dict[str, type[BaseModel]] = {}

def register_event_type(event_type: type[BaseModel]) -> None:
    _EVENT_REGISTRY[event_type.__name__] = event_type

def deserialize_event(type_name: str, data: str) -> BaseModel:
    cls = _EVENT_REGISTRY[type_name]
    return cls.model_validate_json(data)
```

**注册时机：** 各 Room 的 `domain_events.py` 在模块底部自动注册：

```python
# meeting/domain_events.py 末尾
from cabinet.core.events.event_registry import register_event_type
register_event_type(SessionStarted)
register_event_type(PerspectiveAdded)
# ... 所有领域事件
```

**需要注册的事件类型（6 个 Room，共 31 种）：**

| Room | 领域事件 |
|------|----------|
| meeting | SessionStarted, PerspectiveAdded, CrossValidationCompleted, ConvergenceAchieved, ExpertWoken, SessionClosed |
| strategy | BlueprintDecoded, BlueprintValidated |
| decision | DecisionSubmitted, DecisionApproved, DecisionRejected, DecisionDelegated, AuthorizationRuleSet, DecisionCascaded |
| office | TaskSubmitted, TaskCancelled, TaskStatusChanged, TaskFailed, WorkflowStarted, WorkflowNodeCompleted, WorkflowCompleted, WorkflowPaused |
| summary | ReviewStarted, InsightsGenerated, DecisionTreeBuilt, ImprovementsSuggested, AuthorizationAudited |
| secretary | CaptainGreeted, InputProcessed, PendingSummarized, NotificationSent, DecisionFiltered |

### 4. AsyncIOEventBus 修改

**当前：** `AsyncIOEventBus.__init__()` 内部创建 `EventStore()`

**修改：** 接受外部 EventStore 注入

```python
class AsyncIOEventBus:
    def __init__(self, event_store: EventStore | SqliteEventStore | None = None):
        self._store = event_store or EventStore()
        ...
```

**注意：** `SqliteEventStore` 的方法为 `async`，而 `EventStore` 的方法为同步。需要在 `publish()` 中判断：

```python
async def publish(self, envelope: MessageEnvelope) -> None:
    if isinstance(self._store, SqliteEventStore):
        await self._store.append(envelope)
    else:
        self._store.append(envelope)
    ...
```

或者统一将 `EventStore.append()` 改为 `async`（更简洁，但破坏现有同步调用）。

**选择方案：** 统一为 async。修改 `EventStore.append()` 为 `async def append()`，同步调用处加 `await`。影响范围有限（仅 `AsyncIOEventBus.publish()` 一处调用）。

### 5. CabinetRuntime 集成

**新增参数：** `db_path: str | None = None`

```python
class CabinetRuntime:
    def __init__(
        self,
        agent_factory: AgentFactory | None = None,
        gateway: object | None = None,
        db_path: str | None = None,
    ):
        self._db_path = db_path
        ...
        if db_path:
            self._event_store = SqliteEventStore(db_path)
            self._bus = AsyncIOEventBus(event_store=self._event_store)
            self._meeting_store = SqliteRoomEventStore("meeting", db_path)
            self._strategy_store = SqliteRoomEventStore("strategy", db_path)
            # ... 其他 Room
        else:
            self._event_store = EventStore()
            self._bus = AsyncIOEventBus(event_store=self._event_store)
            self._meeting_store = RoomEventStore("meeting")
            self._strategy_store = RoomEventStore("strategy")
            # ... 其他 Room

    async def start(self) -> None:
        if self._db_path:
            await self._event_store.initialize()
            for store in self._room_stores:
                await store.initialize()
        await self._wiring.register(...)

    async def stop(self) -> None:
        await self._wiring.unregister_all()
        if self._db_path:
            for store in self._room_stores:
                await store.close()
            await self._event_store.close()
```

### 6. 修复 test_event_contracts.py

**当前问题：** `_collect_contracts()` 在模块级执行，StrategyEventHandler 构造函数需要参数

**修改：** 将模块级执行改为 fixture：

```python
import pytest
from unittest.mock import AsyncMock
...

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
```

所有测试函数从 `all_contracts` fixture 获取数据。

## 向后兼容性

| 变更 | 兼容性影响 |
|------|-----------|
| CabinetRuntime 新增 db_path 参数 | 默认 None，保持内存模式 |
| EventStore.append() 改为 async | 仅 AsyncIOEventBus.publish() 调用，已是 async |
| SqliteRoomEventStore.flush() | 通过 hasattr 检查，内存版无此方法 |
| test_event_contracts.py | 改为 fixture，测试逻辑不变 |

## 测试策略

1. **SqliteEventStore** — 测试 append/get/get_by_type/get_causation_chain，使用临时数据库
2. **SqliteRoomEventStore** — 测试 append+flush/get_all/get_by_type/restore，使用临时数据库
3. **事件注册表** — 测试注册和反序列化
4. **CabinetRuntime 持久化模式** — 测试 start/stop 后状态恢复
5. **CabinetRuntime 内存模式** — 确保现有测试不受影响
6. **test_event_contracts.py** — 确保收集不再报错
