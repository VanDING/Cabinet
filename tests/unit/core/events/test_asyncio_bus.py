import asyncio

import pytest

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.protocol import EventBus
from cabinet.core.events.store import EventStore
from cabinet.models.events import MessageEnvelope


@pytest.fixture
def bus():
    return AsyncIOEventBus()


def test_bus_satisfies_protocol(bus):
    assert isinstance(bus, EventBus)


@pytest.mark.asyncio
async def test_publish_and_subscribe(bus):
    received = []

    async def handler(envelope: MessageEnvelope):
        received.append(envelope)

    await bus.subscribe("task.order", handler)
    env = MessageEnvelope(
        sender="hub:decision-hub",
        recipients=["room:office"],
        message_type="task.order",
        payload={"action": "analyze"},
    )
    await bus.publish(env)
    await asyncio.sleep(0.05)

    assert len(received) == 1
    assert received[0].message_id == env.message_id


@pytest.mark.asyncio
async def test_unsubscribe(bus):
    received = []

    async def handler(envelope: MessageEnvelope):
        received.append(envelope)

    await bus.subscribe("task.order", handler)
    await bus.unsubscribe("task.order", handler)
    env = MessageEnvelope(
        sender="hub:decision-hub",
        recipients=["room:office"],
        message_type="task.order",
        payload={},
    )
    await bus.publish(env)
    await asyncio.sleep(0.05)

    assert len(received) == 0


@pytest.mark.asyncio
async def test_causation_chain(bus):
    env1 = MessageEnvelope(
        sender="room:meeting-room",
        recipients=["hub:decision-hub"],
        message_type="deliberation.proposal",
        payload={"proposal": "expand"},
    )
    await bus.publish(env1)

    env2 = MessageEnvelope(
        sender="hub:decision-hub",
        recipients=["room:office"],
        message_type="task.order",
        payload={"task": "research"},
        causation_id=env1.message_id,
    )
    await bus.publish(env2)

    chain = await bus.get_causation_chain(env2.message_id)
    assert len(chain) == 2
    assert chain[0].message_id == env1.message_id
    assert chain[1].message_id == env2.message_id


@pytest.mark.asyncio
async def test_event_store():
    store = EventStore()
    env = MessageEnvelope(
        sender="room:meeting-room",
        recipients=["hub:decision-hub"],
        message_type="deliberation.proposal",
        payload={"proposal": "expand"},
    )
    await store.append(env)
    assert store.get(env.message_id) == env
    assert len(store.get_by_type("deliberation.proposal")) == 1


@pytest.mark.asyncio
async def test_publish_concurrent_handlers():
    bus = AsyncIOEventBus()
    results = []

    async def handler_a(envelope):
        results.append("a")

    async def handler_b(envelope):
        results.append("b")

    await bus.subscribe("test.event", handler_a)
    await bus.subscribe("test.event", handler_b)

    envelope = MessageEnvelope(
        sender="test",
        recipients=[],
        message_type="test.event",
        payload={},
    )
    await bus.publish(envelope)
    assert "a" in results
    assert "b" in results


@pytest.mark.asyncio
async def test_publish_continues_if_handler_fails():
    bus = AsyncIOEventBus()
    results = []

    async def bad_handler(envelope):
        raise RuntimeError("boom")

    async def good_handler(envelope):
        results.append("good")

    await bus.subscribe("test.event", bad_handler)
    await bus.subscribe("test.event", good_handler)

    envelope = MessageEnvelope(
        sender="test",
        recipients=[],
        message_type="test.event",
        payload={},
    )
    await bus.publish(envelope)
    assert "good" in results
