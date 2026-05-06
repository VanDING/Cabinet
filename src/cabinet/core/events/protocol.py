from __future__ import annotations

from typing import Protocol, runtime_checkable

from cabinet.models.events import MessageEnvelope


@runtime_checkable
class EventBus(Protocol):
    async def publish(self, envelope: MessageEnvelope) -> None: ...
    async def subscribe(self, message_type: str, handler) -> None: ...
    async def unsubscribe(self, message_type: str, handler) -> None: ...
