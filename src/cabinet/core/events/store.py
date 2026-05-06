from __future__ import annotations

import time
from uuid import UUID

from cabinet.models.events import MessageEnvelope

try:
    from cabinet.core.observability import DB_OPERATION_LATENCY

    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False


class EventStore:
    def __init__(self):
        self._events: dict[UUID, MessageEnvelope] = {}
        self._by_type: dict[str, list[MessageEnvelope]] = {}

    async def append(self, envelope: MessageEnvelope) -> None:
        start = time.monotonic()
        self._events[envelope.message_id] = envelope
        if envelope.message_type not in self._by_type:
            self._by_type[envelope.message_type] = []
        self._by_type[envelope.message_type].append(envelope)
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store="eventstore", operation="append").observe(
                time.monotonic() - start
            )

    def get(self, message_id: UUID) -> MessageEnvelope | None:
        return self._events.get(message_id)

    def get_by_type(self, message_type: str) -> list[MessageEnvelope]:
        return self._by_type.get(message_type, [])

    def get_causation_chain(self, message_id: UUID) -> list[MessageEnvelope]:
        chain = []
        current_id = message_id
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            event = self._events.get(current_id)
            if event is None:
                break
            chain.append(event)
            current_id = event.causation_id if event.causation_id != event.message_id else None
        chain.reverse()
        return chain
