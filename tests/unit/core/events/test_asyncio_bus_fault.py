import asyncio

import pytest

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.models.events import MessageEnvelope


@pytest.mark.asyncio
async def test_handler_error_does_not_block_other_handlers():
    bus = AsyncIOEventBus()
    received = []

    async def failing_handler(envelope: MessageEnvelope):
        raise RuntimeError("handler crashed")

    async def good_handler(envelope: MessageEnvelope):
        received.append(envelope)

    await bus.subscribe("test.event", failing_handler)
    await bus.subscribe("test.event", good_handler)
    env = MessageEnvelope(
        sender="test",
        recipients=["test"],
        message_type="test.event",
        payload={},
    )
    await bus.publish(env)
    await asyncio.sleep(0.05)
    assert len(received) == 1


@pytest.mark.asyncio
async def test_handler_error_sends_to_dlq():
    dlq_entries = []

    class MockDLQ:
        async def enqueue(self, **kwargs):
            dlq_entries.append(kwargs)
            return "dlq-id"

    bus = AsyncIOEventBus(dead_letter_queue=MockDLQ())

    async def failing_handler(envelope: MessageEnvelope):
        raise RuntimeError("handler crashed")

    await bus.subscribe("test.event", failing_handler)
    env = MessageEnvelope(
        sender="test",
        recipients=["test"],
        message_type="test.event",
        payload={"key": "value"},
    )
    await bus.publish(env)
    await asyncio.sleep(0.05)
    assert len(dlq_entries) == 1
    assert dlq_entries[0]["event_type"] == "handler.error"
    assert "handler crashed" in dlq_entries[0]["error"]
