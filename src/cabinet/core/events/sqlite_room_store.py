from __future__ import annotations

from typing import Type, TypeVar

import aiosqlite
from pydantic import BaseModel
import time as _time

from cabinet.core.events.event_registry import deserialize_event

try:
    from cabinet.core.observability import DB_OPERATION_LATENCY
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

T = TypeVar("T", bound=BaseModel)


class SqliteRoomEventStore:
    def __init__(self, room_name: str, db_path: str = "data/db/cabinet.db",
                 max_cache_size: int = 10000, conn_manager: object | None = None):
        self._room_name = room_name
        self._db_path = db_path
        self._conn_manager = conn_manager
        self._db: aiosqlite.Connection | None = None
        self._cache: list[BaseModel] = []
        self._persisted_count: int = 0
        self._max_cache_size = max_cache_size

    async def initialize(self) -> None:
        if self._conn_manager is not None:
            self._db = self._conn_manager.connection
        else:
            self._db = await aiosqlite.connect(self._db_path)
            await self._db.commit()
        await self._load_cache()

    def append(self, event: BaseModel) -> None:
        self._cache.append(event)
        if len(self._cache) > self._max_cache_size:
            self._cache = self._cache[-self._max_cache_size:]
            self._persisted_count = max(0, self._persisted_count - 1)

    def get_all(self) -> list[BaseModel]:
        return list(self._cache)

    def get_by_type(self, event_type: Type[T]) -> list[T]:
        return [e for e in self._cache if isinstance(e, event_type)]

    def clear(self) -> None:
        self._cache.clear()
        self._persisted_count = 0

    async def flush(self) -> None:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        new_events = self._cache[self._persisted_count :]
        if not new_events:
            return
        if self._conn_manager is not None:
            params_seq = [
                (self._room_name, type(event).__name__, event.model_dump_json())
                for event in new_events
            ]
            await self._conn_manager.execute_writemany(
                "INSERT INTO room_events (room_name, event_type, event_data) VALUES (?, ?, ?)",
                params_seq,
            )
        else:
            for event in new_events:
                await self._db.execute(
                    "INSERT INTO room_events (room_name, event_type, event_data) VALUES (?, ?, ?)",
                    (self._room_name, type(event).__name__, event.model_dump_json()),
                )
            await self._db.commit()
        self._persisted_count = len(self._cache)
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store=self._room_name, operation="flush").observe(
                _time.monotonic() - start
            )

    async def _load_cache(self) -> None:
        cursor = await self._db.execute(
            "SELECT event_type, event_data FROM room_events WHERE room_name = ? ORDER BY seq",
            (self._room_name,),
        )
        rows = await cursor.fetchall()
        for type_name, data in rows:
            event = deserialize_event(type_name, data)
            self._cache.append(event)
        self._persisted_count = len(self._cache)

    async def close(self) -> None:
        await self.flush()
        if self._conn_manager is None and self._db:
            await self._db.close()
        self._db = None

    @property
    def room_name(self) -> str:
        return self._room_name
