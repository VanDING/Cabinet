import pytest
import pytest_asyncio
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.core.events.event_registry import register_event_type
from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
from cabinet.core.events.sqlite_room_store import SqliteRoomEventStore


class RoomStoreEvent(BaseModel):
    item_id: UUID
    name: str


class RoomStoreItem(BaseModel):
    item_id: UUID
    value: str


register_event_type(RoomStoreEvent)
register_event_type(RoomStoreItem)


@pytest_asyncio.fixture
async def store(tmp_path):
    db_path = str(tmp_path / "room.db")
    runner = MigrationRunner(db_path, [V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()
    await runner.close()
    s = SqliteRoomEventStore("test_room", db_path)
    await s.initialize()
    yield s
    await s.close()


def test_sqlite_room_store_append_and_get_all(store):
    e1 = RoomStoreEvent(item_id=uuid4(), name="hello")
    e2 = RoomStoreItem(item_id=uuid4(), value="world")
    store.append(e1)
    store.append(e2)
    all_events = store.get_all()
    assert len(all_events) == 2
    assert all_events[0].name == "hello"
    assert all_events[1].value == "world"


def test_sqlite_room_store_get_by_type(store):
    e1 = RoomStoreEvent(item_id=uuid4(), name="hello")
    e2 = RoomStoreItem(item_id=uuid4(), value="world")
    e3 = RoomStoreEvent(item_id=uuid4(), name="foo")
    store.append(e1)
    store.append(e2)
    store.append(e3)
    test_events = store.get_by_type(RoomStoreEvent)
    assert len(test_events) == 2


def test_sqlite_room_store_clear(store):
    store.append(RoomStoreEvent(item_id=uuid4(), name="x"))
    store.clear()
    assert store.get_all() == []


def test_sqlite_room_store_get_all_returns_copy(store):
    store.append(RoomStoreEvent(item_id=uuid4(), name="x"))
    events = store.get_all()
    events.clear()
    assert len(store.get_all()) == 1


@pytest.mark.asyncio
async def test_sqlite_room_store_persists_across_reopen(tmp_path):
    db_path = str(tmp_path / "persist_room.db")
    runner = MigrationRunner(db_path, [V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()
    await runner.close()
    e1 = RoomStoreEvent(item_id=uuid4(), name="persisted")

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
    runner = MigrationRunner(db_path, [V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()
    await runner.close()
    e1 = RoomStoreEvent(item_id=uuid4(), name="first")
    e2 = RoomStoreItem(item_id=uuid4(), value="second")

    store1 = SqliteRoomEventStore("test_room", db_path)
    await store1.initialize()
    store1.append(e1)
    store1.append(e2)
    await store1.flush()
    await store1.close()

    store2 = SqliteRoomEventStore("test_room", db_path)
    await store2.initialize()
    test_events = store2.get_by_type(RoomStoreEvent)
    await store2.close()
    assert len(test_events) == 1
    assert test_events[0].name == "first"
