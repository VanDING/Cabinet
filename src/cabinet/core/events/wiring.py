from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from pydantic import BaseModel

from cabinet.core.events.protocol import EventBus
from cabinet.models.events import MessageEnvelope


class EventContract(BaseModel):
    room_name: str
    produces: list[str]
    consumes: list[str]


@runtime_checkable
class RoomEventHandler(Protocol):
    @property
    def contract(self) -> EventContract: ...

    async def handle(self, envelope: MessageEnvelope) -> None: ...


@runtime_checkable
class RoomEventPublisher(Protocol):
    async def publish(
        self,
        room_name: str,
        message_type: str,
        payload: BaseModel,
        causation_id: UUID | None = None,
    ) -> None: ...


class RoomEventWiring:
    def __init__(self, bus: EventBus):
        self._bus = bus
        self._handlers: dict[str, RoomEventHandler] = {}

    async def register(self, handler: RoomEventHandler) -> None:
        self._handlers[handler.contract.room_name] = handler
        for msg_type in handler.contract.consumes:
            await self._bus.subscribe(msg_type, handler.handle)

    async def publish(
        self,
        room_name: str,
        message_type: str,
        payload: BaseModel,
        causation_id: UUID | None = None,
    ) -> None:
        sender = f"room:{room_name}"
        recipients = self.resolve_recipients(message_type)
        envelope = MessageEnvelope(
            sender=sender,
            recipients=recipients,
            message_type=message_type,
            payload=payload.model_dump(),
        )
        if causation_id is not None:
            envelope.causation_id = causation_id
        await self._bus.publish(envelope)

    def resolve_recipients(self, message_type: str) -> list[str]:
        return [
            f"room:{h.contract.room_name}"
            for h in self._handlers.values()
            if message_type in h.contract.consumes
        ]

    async def unregister_all(self) -> None:
        for handler in self._handlers.values():
            for msg_type in handler.contract.consumes:
                await self._bus.unsubscribe(msg_type, handler.handle)
        self._handlers.clear()
