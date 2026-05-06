from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from uuid import UUID

from cabinet.core.events.store import EventStore
from cabinet.models.events import MessageEnvelope

try:
    from cabinet.core.observability import EVENT_PUBLISHED, get_tracer

    _tracer = get_tracer("cabinet.eventbus")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

logger = logging.getLogger(__name__)


class AsyncIOEventBus:
    def __init__(self, event_store: EventStore | None = None, dead_letter_queue: object | None = None):
        self._handlers: dict[str, list] = defaultdict(list)
        self._store = event_store or EventStore()
        self._dlq = dead_letter_queue

    async def publish(self, envelope: MessageEnvelope) -> None:
        if _OBSERVABILITY_ENABLED:
            EVENT_PUBLISHED.labels(message_type=envelope.message_type).inc()
        span = None
        if _OBSERVABILITY_ENABLED:
            span = _tracer.start_span("eventbus.publish")
            span.set_attribute("event.type", envelope.message_type)
            span.set_attribute("event.source", envelope.sender)
        try:
            handlers = self._handlers.get(envelope.message_type, [])
            if handlers:
                tasks = [self._invoke_handler(h, envelope) for h in handlers]
                await asyncio.gather(*tasks, return_exceptions=True)
            if self._store is not None:
                try:
                    await self._store.append(envelope)
                except Exception as exc:
                    logger.warning("Event persistence failed for %s: %s", envelope.message_type, exc)
        finally:
            if span:
                span.end()

    async def _invoke_handler(self, handler, envelope: MessageEnvelope) -> None:
        try:
            await asyncio.wait_for(handler(envelope), timeout=30.0)
        except asyncio.TimeoutError:
            logger.warning("Handler %s timed out for %s", handler.__name__, envelope.message_type)
            if self._dlq is not None:
                await self._dlq.enqueue(
                    event_type="handler.timeout",
                    source=f"eventbus:{envelope.message_type}",
                    payload={"message_id": str(envelope.message_id), "handler": handler.__name__},
                    error="timeout after 30s",
                )
        except Exception as exc:
            logger.exception("Handler %s failed for %s: %s", handler.__name__, envelope.message_type, exc)
            if self._dlq is not None:
                await self._dlq.enqueue(
                    event_type="handler.error",
                    source=f"eventbus:{envelope.message_type}",
                    payload={"message_id": str(envelope.message_id), "sender": envelope.sender},
                    error=str(exc),
                )

    async def subscribe(self, message_type: str, handler) -> None:
        self._handlers[message_type].append(handler)

    async def unsubscribe(self, message_type: str, handler) -> None:
        if message_type in self._handlers:
            self._handlers[message_type] = [h for h in self._handlers[message_type] if h != handler]

    async def get_causation_chain(self, message_id: UUID) -> list[MessageEnvelope]:
        return self._store.get_causation_chain(message_id)
