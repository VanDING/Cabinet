from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TypeVar, Type
from uuid import UUID

from pydantic import BaseModel

from cabinet.core.events.wiring import RoomEventPublisher

T = TypeVar("T", bound=BaseModel)


class RoomEventStore:
    def __init__(self, room_name: str):
        self._room_name = room_name
        self._events: list[BaseModel] = []

    @property
    def room_name(self) -> str:
        return self._room_name

    def append(self, event: BaseModel) -> None:
        self._events.append(event)

    def get_all(self) -> list[BaseModel]:
        return list(self._events)

    def get_by_type(self, event_type: Type[T]) -> list[T]:
        return [e for e in self._events if isinstance(e, event_type)]

    def clear(self) -> None:
        self._events.clear()


class EventSourcedRoom(ABC):
    def __init__(self, store: RoomEventStore, publisher: RoomEventPublisher):
        self._store = store
        self._publisher = publisher

    @abstractmethod
    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]: ...

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

    async def restore_from_events(self) -> None:
        for event in self._store.get_all():
            self._apply_event(event)
