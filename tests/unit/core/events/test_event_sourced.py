import pytest

from pydantic import BaseModel
from uuid import UUID, uuid4

from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher


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
